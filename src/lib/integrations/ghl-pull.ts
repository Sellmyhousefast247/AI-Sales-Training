import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationRow, NormalizedInboundCall } from "./types";
import { ingestNormalizedCall, processCallMedia } from "./ingest";
import { fetchWavvRecording, wavvConfigured } from "./wavv";
import { transcribeRecordingBuffer, transcriptionConfigured } from "@/lib/transcription/deepgram";

/**
 * Pull-based GoHighLevel/XLeads call sync.
 *
 * WAVV power-dialer calls are logged into GHL conversations as TYPE_CALL
 * messages but do NOT fire GHL workflow triggers ("Call Details" /
 * "Transcript Generated" only fire for GHL-native telephony events), so the
 * push webhook misses them entirely. This module polls the GHL REST API for
 * recent call messages, downloads each recording (authenticated), transcribes
 * it with Deepgram, and hands the result to the normal ingest+scoring
 * pipeline.
 *
 * Auth: Private Integration token (env GHL_API_TOKEN, `pit-…`).
 * Cursor: integrations.config_json.pull_cursor_iso (with a re-scan overlap;
 * dedup on external_id keeps re-scans idempotent).
 */

const API_BASE = "https://services.leadconnectorhq.com";
const CONVERSATIONS_VERSION = "2021-04-15";
const CONTACTS_VERSION = "2021-07-28";

/**
 * How far behind the cursor each run re-scans. WAVV syncs dialer calls into
 * GHL late — sometimes hours after the call, with a backdated timestamp — so
 * this must be generous. Dedup on message id keeps re-scans idempotent.
 */
const OVERLAP_MS = 6 * 60 * 60 * 1000;
/** First-run lookback when no cursor exists yet. */
const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
/**
 * Call messages are considered candidates within this window regardless of
 * the conversation-scan cursor — catches backdated late-synced calls.
 */
const CANDIDATE_LOOKBACK_MS = 48 * 60 * 60 * 1000;
/** Conversations page size + max pages (SMS blasts can flood the recent list). */
const CONVERSATIONS_PAGE_SIZE = 100;
const MAX_CONVERSATION_PAGES = 5;
const MAX_MESSAGES_PER_CONVERSATION = 40;
/**
 * Cap heavy work (download+transcribe+score) per run; cron cadence catches up.
 * Kept small so a full batch (~100s per scored call worst-case) stays inside
 * the 300s function limit — a timeout mid-run would forfeit the whole batch.
 */
const MAX_NEW_CALLS_PER_RUN = 3;
/**
 * Hard wall-clock budget for a single pull run. The Vercel function dies at
 * 300s; if scanning ever exceeds this budget the run stops early, records
 * what it has, and — critically — still advances the cursor. Without this,
 * one busy afternoon of SMS-blast conversations made every run overrun 300s,
 * die before the cursor update, and re-scan the same window forever.
 * 190s leaves ~110s of headroom: one in-flight transcription/scoring pass
 * started just under budget must still finish before the 300s hard kill.
 */
const RUN_BUDGET_MS = 190_000;
/**
 * WAVV dialer calls often leave NO conversation message — the contact note is
 * the only trace. So notes can't be discovered only via message candidates:
 * also check the contacts behind the most recently active conversations.
 */
const NOTES_CONTACTS_CAP = 60;

export interface PullSummary {
  ok: boolean;
  scanned_conversations: number;
  candidate_calls: number;
  created: number;
  duplicates: number;
  skipped: number;
  failed: number;
  cursor: string | null;
  details: Array<{ external_id: string; status: string; detail?: string }>;
  error?: string;
}

interface GhlClientOpts {
  token: string;
  locationId: string;
}

async function ghlFetch(
  opts: GhlClientOpts,
  path: string,
  version: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Version: version,
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function ghlJson<T>(opts: GhlClientOpts, path: string, version: string): Promise<T> {
  const resp = await ghlFetch(opts, path, version);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`GHL ${resp.status} ${path}: ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

function pick(obj: any, ...keys: string[]): any {
  for (const k of keys) {
    const v = k.split(".").reduce((o, part) => (o == null ? undefined : o[part]), obj);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function toIso(v: unknown): string | null {
  if (v == null) return null;
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Cache GHL userId → email lookups within a run. */
async function lookupUserEmail(
  opts: GhlClientOpts,
  cache: Map<string, string | null>,
  userId: string
): Promise<string | null> {
  if (cache.has(userId)) return cache.get(userId) ?? null;
  try {
    const data: any = await ghlJson(opts, `/users/${userId}`, CONTACTS_VERSION);
    const email = (pick(data, "email", "user.email") ?? null) as string | null;
    cache.set(userId, email);
    return email;
  } catch {
    cache.set(userId, null);
    return null;
  }
}

async function lookupContact(
  opts: GhlClientOpts,
  cache: Map<string, any>,
  contactId: string
): Promise<any | null> {
  if (cache.has(contactId)) return cache.get(contactId);
  try {
    const data: any = await ghlJson(opts, `/contacts/${contactId}`, CONTACTS_VERSION);
    const contact = data?.contact ?? data ?? null;
    cache.set(contactId, contact);
    return contact;
  } catch {
    cache.set(contactId, null);
    return null;
  }
}

/**
 * Lead source from the contact's src_* tag (e.g. src_facebook -> "facebook",
 * src_ppl_motivatedsellers -> "ppl motivatedsellers"). Every contact gets one
 * of these tags at intake; it is far more reliable than the free-form
 * contact.source field, which is often blank or set to a form name.
 */
function srcTagOf(contact: any): string | null {
  const tags = pick(contact, "tags");
  if (!Array.isArray(tags)) return null;
  for (const t of tags) {
    const tag = String(t ?? "").trim();
    if (/^src[_-]/i.test(tag)) {
      const v = tag.replace(/^src[_-]/i, "").replace(/[_-]+/g, " ").trim();
      if (v) return v;
    }
  }
  return null;
}

/** Download a call recording; null when the message has none (404). */
async function downloadRecording(
  opts: GhlClientOpts,
  messageId: string
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const resp = await ghlFetch(
    opts,
    `/conversations/messages/${messageId}/locations/${opts.locationId}/recording`,
    CONVERSATIONS_VERSION
  );
  // 404/422 = message has no recording (voicemail drops, unrecorded calls).
  // 429 = rate-limited — treat as "not now" so the heavy slot is refunded
  // and the call retries on a later run instead of counting as failed.
  if (resp.status === 404 || resp.status === 422 || resp.status === 429) return null;
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`GHL recording ${resp.status}: ${text.slice(0, 200)}`);
  }
  const bytes = await resp.arrayBuffer();
  if (bytes.byteLength === 0) return null;
  return { bytes, contentType: resp.headers.get("content-type") ?? "audio/wav" };
}

interface CandidateCall {
  /** External id used for dedup: GHL message id, or `wavv:<uuid>` for notes. */
  messageId: string;
  source: "message" | "note";
  conversationId: string;
  contactId: string | null;
  direction: "inbound" | "outbound" | null;
  dateAdded: string | null;
  durationSec: number | null;
  userId: string | null;
  /** Direct recording URL (WAVV serves plain public MP3s). */
  attachmentUrl: string | null;
  /** WAVV call uuid from the note marker — recording fetchable via WAVV API. */
  wavvUuid: string | null;
}

/**
 * WAVV's GHL integration logs each dialer call as a contact NOTE like:
 *   [ WAVV: 019fd8c9-57a1-7557-98ab-68bc3dfafcc7 ]
 *   To: (719) 310-7853 (5) / From: (720) 897-0691
 *   Duration: 337 seconds / Disposition: Callback
 *   https://file.wavv.com/recordings/<hash>/<phone>.mp3?download=true
 * This is the ONLY place the recording URL appears — call messages carry no
 * recording (the GHL recording endpoint 422s for WAVV calls).
 */
export function noteToCandidate(contactId: string, note: any): CandidateCall | null {
  const body = String(pick(note, "body", "content", "note") ?? "");
  const urlRaw = body.match(/(?:https?:\/\/)?file\.wavv\.com\/recordings\/[^\s"'<>)\]]+/i)?.[0];
  const url = urlRaw ? (urlRaw.startsWith("http") ? urlRaw : `https://${urlRaw}`) : null;
  const wavvId = body.match(/\[\s*WAVV:\s*([0-9a-f-]{10,})\s*\]/i)?.[1] ?? null;
  // Aug-7+ note vintage dropped the MP3 URL — a WAVV uuid alone still
  // qualifies, because the recording is fetchable via the WAVV API.
  if (!url && !wavvId) return null;
  const duration = body.match(/Duration:\s*(\d+)\s*seconds/i)?.[1];
  const noteId = pick(note, "id", "noteId");
  const externalId = wavvId ? `wavv:${wavvId}` : noteId ? `wavv-note:${noteId}` : null;
  if (!externalId) return null;
  return {
    messageId: externalId,
    source: "note",
    conversationId: "",
    contactId,
    direction: "outbound", // WAVV notes come from the power dialer
    dateAdded: toIso(pick(note, "dateAdded", "createdAt", "date_added")),
    durationSec: duration != null ? Number(duration) : null,
    userId: (pick(note, "userId", "user_id", "createdBy") ?? null) as string | null,
    attachmentUrl: url,
    wavvUuid: wavvId,
  };
}

/**
 * WAVV (with "transcription to notes" enabled) posts the FULL call transcript
 * into a contact note. Format isn't guaranteed, so detection is structural:
 * a long note whose text is dominated by repeated dialogue speaker labels
 * (or timestamped lines), and which is not one of the known WAVV/automation
 * note types (summary, deal sheet, QC, assignment).
 */
export interface TranscriptNote {
  noteId: string;
  contactId: string;
  dateAdded: string | null;
  wavvUuid: string | null;
  text: string;
  wordCount: number;
}

/** Convert a (possibly HTML) note body to plain text with line breaks. */
export function htmlNoteToText(body: string): string {
  return String(body ?? "")
    .replace(/<\s*(?:br|\/p|\/div|\/li|\/h[1-6])\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim();
}

const NON_TRANSCRIPT_MARKERS =
  /-{3,}\s*Summary\s*-{3,}|Motivation \(Go Deep!\)|QC UNDERWRITING|Lead assignment processed|Owner assigned to/i;

export function looksLikeTranscriptNote(text: string): boolean {
  if (!text || text.length < 600) return false;
  if (NON_TRANSCRIPT_MARKERS.test(text)) return false;
  // Dialogue signal 1: the SAME short speaker label repeats many times
  // ("Agent:", "Rep:", "John:", "Speaker 1:").
  const labelCounts = new Map<string, number>();
  const labelRe = /(?:^|\n)\s*([A-Za-z][A-Za-z0-9 .'-]{0,24}):\s+\S/g;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(text)) !== null) {
    const label = m[1].trim().toLowerCase();
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  const maxRepeat = Math.max(0, ...labelCounts.values());
  // Dialogue signal 2: timestamped lines ("[00:12]", "00:01:02").
  const timestamps = (text.match(/\[?\b\d{1,2}:\d{2}(?::\d{2})?\b\]?/g) ?? []).length;
  // Explicit header signal.
  const headed = /transcript/i.test(text.slice(0, 120));
  return maxRepeat >= 4 || timestamps >= 6 || (headed && maxRepeat >= 2);
}

export function noteToTranscript(contactId: string, note: any): TranscriptNote | null {
  const raw = String(pick(note, "body", "content", "note") ?? "");
  if (!raw || raw.length < 600) return null;
  const text = htmlNoteToText(raw);
  if (!looksLikeTranscriptNote(text)) return null;
  const noteId = String(pick(note, "id", "noteId") ?? "");
  if (!noteId) return null;
  const wordCount = text.split(/\s+/).length;
  if (wordCount < 120) return null; // too thin to be a >=10-min call transcript
  return {
    noteId,
    contactId,
    dateAdded: toIso(pick(note, "dateAdded", "createdAt", "date_added")),
    wavvUuid: raw.match(/\[\s*WAVV:\s*([0-9a-f-]{10,})\s*\]/i)?.[1] ?? null,
    text,
    wordCount,
  };
}

/** WAVV dialer calls attach the recording as a plain MP3 URL on the message. */
function extractRecordingAttachment(msg: any): string | null {
  const atts = pick(msg, "attachments");
  if (!Array.isArray(atts)) return null;
  for (const a of atts) {
    const url = typeof a === "string" ? a : (pick(a, "url", "fileUrl", "href") as string | undefined);
    if (!url || typeof url !== "string") continue;
    if (/file\.wavv\.com|\.mp3|\.wav|\.m4a|\.ogg/i.test(url)) return url;
  }
  return null;
}

export function messageToCandidate(conv: any, msg: any): CandidateCall | null {
  const type = String(pick(msg, "messageType", "type") ?? "");
  if (!type.toUpperCase().includes("CALL")) return null;
  const id = pick(msg, "id", "messageId");
  if (!id) return null;
  const status = String(pick(msg, "status") ?? "").toLowerCase();
  // Skip in-flight events; keep terminal + unknown statuses.
  if (["ringing", "in-progress", "queued", "initiated"].includes(status)) return null;

  const durationRaw = pick(
    msg,
    "meta.call.duration",
    "meta.callDuration",
    "meta.call_duration",
    "callDuration",
    "duration"
  );
  const duration = durationRaw != null ? Number(durationRaw) : null;
  const dir = String(pick(msg, "direction") ?? "").toLowerCase();

  return {
    messageId: String(id),
    source: "message",
    conversationId: String(pick(conv, "id", "conversationId") ?? ""),
    contactId: (pick(msg, "contactId") ?? pick(conv, "contactId") ?? null) as string | null,
    direction: dir === "inbound" ? "inbound" : dir === "outbound" ? "outbound" : null,
    dateAdded: toIso(pick(msg, "dateAdded", "createdAt", "date_added")),
    durationSec: Number.isFinite(duration as number) ? (duration as number) : null,
    userId: (pick(msg, "userId", "user_id") ?? null) as string | null,
    attachmentUrl: extractRecordingAttachment(msg),
    wavvUuid: null,
  };
}

/** Download a recording from a direct URL (no auth — WAVV MP3s are public). */
async function downloadRecordingFromUrl(
  url: string
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const bytes = await resp.arrayBuffer();
    if (bytes.byteLength === 0) return null;
    return { bytes, contentType: resp.headers.get("content-type") ?? "audio/mpeg" };
  } catch {
    return null;
  }
}

/**
 * One sync pass. Reads new TYPE_CALL messages since the stored cursor,
 * transcribes + ingests + scores them, then advances the cursor.
 */
export async function pullGoHighLevelCalls(
  admin: SupabaseClient,
  integration: IntegrationRow,
  env: { token?: string | null; locationId?: string | null } = {},
  opts: { lookbackHours?: number | null; contactId?: string | null } = {}
): Promise<PullSummary> {
  const summary: PullSummary = {
    ok: true,
    scanned_conversations: 0,
    candidate_calls: 0,
    created: 0,
    duplicates: 0,
    skipped: 0,
    failed: 0,
    cursor: null,
    details: [],
  };

  const cfg = (integration.config_json ?? {}) as Record<string, any>;
  const token = env.token ?? process.env.GHL_API_TOKEN ?? null;
  const locationId = env.locationId ?? cfg.ghl_location_id ?? process.env.GHL_LOCATION_ID ?? null;

  if (!token) return { ...summary, ok: false, error: "GHL_API_TOKEN is not configured" };
  if (!locationId) return { ...summary, ok: false, error: "GHL location id is not configured" };
  if (!transcriptionConfigured()) {
    return { ...summary, ok: false, error: "DEEPGRAM_API_KEY is not configured" };
  }

  const opts_: GhlClientOpts = { token, locationId };
  const now = Date.now();
  const runStarted = Date.now();
  const overBudget = () => Date.now() - runStarted > RUN_BUDGET_MS;
  // The GHL scan (conversation pages, per-conversation messages, per-contact
  // notes) is unbounded API fan-out, and GHL latency degrades to ~3s/request
  // under load — one busy evening the message scan alone ate the whole 300s.
  // Each phase gets its own deadline so the later, MORE important work always
  // runs: notes (the only evidence of WAVV dialer calls) get time even when
  // the message scan is starved, and candidate processing always gets ~60s+.
  const MSG_SCAN_DEADLINE_MS = 55_000; // conversation pages + per-conv messages
  const NOTES_SCAN_DEADLINE_MS = 130_000; // per-contact notes
  const msgScanOverBudget = () => Date.now() - runStarted > MSG_SCAN_DEADLINE_MS;
  const scanOverBudget = () => Date.now() - runStarted > NOTES_SCAN_DEADLINE_MS;
  const cursorIso: string | null = cfg.pull_cursor_iso ?? null;
  // Conversation-scan window: explicit lookback override (deep sweeps), else
  // cursor minus a generous overlap for WAVV's late syncs. A stale cursor is
  // clamped so a stuck run can never balloon the window past the candidate
  // horizon — the nightly deep sweep owns anything older.
  const rawSinceMs = opts.lookbackHours
    ? now - opts.lookbackHours * 60 * 60 * 1000
    : cursorIso
      ? new Date(cursorIso).getTime() - OVERLAP_MS
      : now - INITIAL_LOOKBACK_MS;
  const sinceMs = opts.lookbackHours
    ? rawSinceMs
    : Math.max(rawSinceMs, now - CANDIDATE_LOOKBACK_MS - OVERLAP_MS);
  // Candidate window: never narrower than 48h — backdated call messages must
  // still qualify even when the scan cursor is fresh. Dedup keeps this cheap.
  const candidateSinceMs = Math.min(sinceMs, now - CANDIDATE_LOOKBACK_MS);

  // 1) Recently-active conversations, newest first, paginated — SMS blasts
  // can push a call conversation far down the recent list. Targeted mode
  // (opts.contactId) skips the scan and reads that contact's notes directly.
  const conversations: any[] = [];
  let startAfterDate: number | null = null;
  for (let page = 0; !opts.contactId && page < MAX_CONVERSATION_PAGES && !msgScanOverBudget(); page++) {
    const pageParam = startAfterDate ? `&startAfterDate=${startAfterDate}` : "";
    let batch: any[] = [];
    try {
      const search: any = await ghlJson(
        opts_,
        `/conversations/search?locationId=${encodeURIComponent(locationId)}&limit=${CONVERSATIONS_PAGE_SIZE}&sortBy=last_message_date&sort=desc${pageParam}`,
        CONVERSATIONS_VERSION
      );
      batch = search?.conversations ?? search?.data ?? [];
    } catch (err) {
      if (page === 0) throw err;
      break; // pagination hiccup — work with what we have
    }
    if (batch.length === 0) break;
    // Guard against a paging param the API ignores (same page repeating).
    if (conversations.length > 0 && pick(batch[0], "id") === pick(conversations[conversations.length - batch.length] ?? {}, "id")) break;
    conversations.push(...batch);
    const oldest = toIso(pick(batch[batch.length - 1], "lastMessageDate", "last_message_date", "dateUpdated", "updatedAt"));
    if (!oldest) break;
    const oldestMs = new Date(oldest).getTime();
    if (oldestMs < sinceMs) break; // covered the whole scan window
    startAfterDate = oldestMs;
  }

  // 2) Collect candidate call messages inside the candidate window.
  const candidates: CandidateCall[] = [];
  for (const conv of conversations) {
    if (msgScanOverBudget()) {
      summary.details.push({
        external_id: "(budget)",
        status: "skipped",
        detail: `message-scan deadline reached (${summary.scanned_conversations} conversations in); notes scan still runs`,
      });
      break;
    }
    const lastMsgIso = toIso(
      pick(conv, "lastMessageDate", "last_message_date", "dateUpdated", "updatedAt")
    );
    if (lastMsgIso && new Date(lastMsgIso).getTime() < sinceMs) break; // sorted desc — done
    summary.scanned_conversations++;

    const convId = pick(conv, "id", "conversationId");
    if (!convId) continue;
    let msgs: any[] = [];
    try {
      const data: any = await ghlJson(
        opts_,
        `/conversations/${convId}/messages?limit=${MAX_MESSAGES_PER_CONVERSATION}`,
        CONVERSATIONS_VERSION
      );
      msgs = data?.messages?.messages ?? data?.messages ?? [];
    } catch {
      continue; // one bad conversation shouldn't kill the run
    }
    for (const msg of msgs) {
      const cand = messageToCandidate(conv, msg);
      if (!cand) continue;
      if (cand.dateAdded && new Date(cand.dateAdded).getTime() < candidateSinceMs) continue;
      candidates.push(cand);
    }
  }

  // 2b) WAVV logs each dialer call as a contact NOTE holding the only copy of
  // the recording URL. Fetch notes for every contact that had call activity
  // and turn WAVV notes into candidates. Notes are the primary source for
  // dialer calls; the message path only succeeds for GHL-native telephony.
  // Contacts worth a notes check: every message-candidate contact PLUS the
  // contacts behind the most recently active conversations (newest first).
  // WAVV dialer calls frequently leave no conversation message at all — the
  // note is the only evidence — so message candidates alone miss them.
  const recentConvContacts = conversations
    .map((conv) => pick(conv, "contactId", "contact_id") as string | undefined)
    .filter(Boolean) as string[];
  const noteContactIds = opts.contactId
    ? [opts.contactId]
    : [
        ...new Set([
          ...(candidates.map((c) => c.contactId).filter(Boolean) as string[]),
          ...recentConvContacts.slice(0, NOTES_CONTACTS_CAP),
        ]),
      ];
  let notesDenied = 0;
  let notesFetched = 0;
  let wavvNotes = 0;
  const transcriptNotes: TranscriptNote[] = [];
  const usedTranscriptNoteIds = new Set<string>();
  /** Best transcript note for a call: same WAVV uuid, else same contact closest in time (±6h). */
  const findTranscriptFor = (cand: CandidateCall): TranscriptNote | null => {
    let best: TranscriptNote | null = null;
    let bestDelta = Infinity;
    const callMs = cand.dateAdded ? new Date(cand.dateAdded).getTime() : null;
    for (const tn of transcriptNotes) {
      if (usedTranscriptNoteIds.has(tn.noteId)) continue;
      if (cand.wavvUuid && tn.wavvUuid) {
        if (tn.wavvUuid === cand.wavvUuid) return tn;
        continue;
      }
      if (tn.contactId !== cand.contactId) continue;
      if (callMs == null || !tn.dateAdded) { if (!best) best = tn; continue; }
      const delta = Math.abs(new Date(tn.dateAdded).getTime() - callMs);
      if (delta <= 6 * 3600_000 && delta < bestDelta) { best = tn; bestDelta = delta; }
    }
    return best;
  };
  const noteErrors: string[] = [];
  for (const cid of noteContactIds) {
    if (scanOverBudget()) {
      if (noteErrors.length < 3) noteErrors.push("scan budget reached during notes scan");
      break;
    }
    let notes: any[] = [];
    try {
      const data: any = await ghlJson(opts_, `/contacts/${cid}/notes`, CONTACTS_VERSION);
      notes = data?.notes ?? data ?? [];
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg.includes(" 401") || msg.includes(" 403")) notesDenied++;
      if (noteErrors.length < 3) noteErrors.push(msg.slice(0, 140));
      continue;
    }
    if (!Array.isArray(notes)) {
      if (noteErrors.length < 3) noteErrors.push(`unexpected notes shape: ${JSON.stringify(notes).slice(0, 120)}`);
      continue;
    }
    notesFetched += notes.length;
    for (const note of notes) {
      const tn = noteToTranscript(cid, note);
      if (tn) {
        if (!tn.dateAdded || new Date(tn.dateAdded).getTime() >= candidateSinceMs) {
          transcriptNotes.push(tn);
        }
        continue; // a transcript note is never a call-marker note
      }
      const cand = noteToCandidate(cid, note);
      if (!cand) continue;
      wavvNotes++;
      if (cand.dateAdded && new Date(cand.dateAdded).getTime() < candidateSinceMs) continue;
      candidates.push(cand);
    }
  }
  if (opts.contactId || noteErrors.length > 0) {
    summary.details.push({
      external_id: "(notes-debug)",
      status: "skipped",
      detail: `contacts=${noteContactIds.length} notes=${notesFetched} wavvNotes=${wavvNotes} errors=${noteErrors.join(" | ") || "none"}`,
    });
  }
  if (notesDenied > 0) {
    summary.details.push({
      external_id: "(scope)",
      status: "failed",
      detail: `notes API denied for ${notesDenied} contacts — add the View Contact Notes scope to the Private Integration`,
    });
  }
  summary.candidate_calls = candidates.length;
  console.log(
    `[pull] scan ${Date.now() - runStarted}ms: convs=${conversations.length} candidates=${candidates.length} notesContacts=${noteContactIds.length} notes=${notesFetched} wavvNotes=${wavvNotes} transcriptNotes=${transcriptNotes.length}`
  );

  // Note-sourced candidates first (they carry a guaranteed recording URL, so
  // heavy slots are never wasted), then oldest-first within each source.
  candidates.sort(
    (a, b) =>
      (a.source === "note" ? 0 : 1) - (b.source === "note" ? 0 : 1) ||
      String(a.dateAdded ?? "").localeCompare(String(b.dateAdded ?? ""))
  );

  const userEmailCache = new Map<string, string | null>();
  const contactCache = new Map<string, any>();
  // Only auto-ingest/score calls that are at least 10 minutes long. Shorter
  // calls are almost never real sales conversations, so scoring them wastes
  // transcription + model spend. Enforced as a hard floor: config may raise the
  // threshold but not lower it below 10 minutes.
  const MIN_SCORE_DURATION_SEC = 600;
  const minDuration = Math.max(MIN_SCORE_DURATION_SEC, cfg.min_duration_sec ?? 0);
  let processedHeavy = 0;
  /** Oldest call deferred by the per-run cap — the cursor must not pass it. */
  let oldestDeferredIso: string | null = null;
  const noteDeferred = (cand: CandidateCall) => {
    if (cand.dateAdded && (!oldestDeferredIso || cand.dateAdded < oldestDeferredIso)) {
      oldestDeferredIso = cand.dateAdded;
    }
  };
  // Permanently-skipped junk (tiny clips, sub-minimum recordings), persisted in
  // config so each junk clip is downloaded and probed exactly ONCE ever. Without
  // this every 5-min run re-downloaded the same voicemail beeps across the whole
  // 48h candidate window and burned the entire run budget doing it.
  const junkIds = new Set<string>(Array.isArray(cfg.pull_junk_ids) ? (cfg.pull_junk_ids as string[]) : []);
  let junkSkips = 0;
  let budgetDeferred = 0;

  /** Note timestamps are POST time (after the call); back them up by the
   * call duration so stored call_datetime is the actual call start — which
   * also makes cross-source twin matching symmetric. */
  const callStartIso = (c: CandidateCall): string | null =>
    c.dateAdded && c.source === "note" && c.durationSec
      ? new Date(new Date(c.dateAdded).getTime() - c.durationSec * 1000).toISOString()
      : c.dateAdded;

  // WAVV now logs every dialer call TWICE: a conversation message (no duration
  // metadata) and a WAVV note (duration + uuid — the authority). The
  // null-duration message twins used to each cost a download probe; at
  // hundreds of dials/day that flooded the run budget and deferred every real
  // call. Match them against their note twin in-memory and junk them for free.
  const noteStarts = candidates
    .filter((c) => c.source === "note" && c.contactId && c.dateAdded && c.durationSec != null)
    .map((c) => ({
      contactId: c.contactId as string,
      startMs: new Date(c.dateAdded as string).getTime() - (c.durationSec as number) * 1000,
    }));

  for (const cand of candidates) {
    // Known junk from a previous run — don't even do the dedup select.
    if (junkIds.has(cand.messageId)) {
      junkSkips++;
      summary.skipped++;
      continue;
    }
    // Message twin of a WAVV note in this batch: the note carries the real
    // duration and uuid, so this copy never needs a probe or a DB select.
    if (cand.source === "message" && cand.durationSec == null && cand.contactId && cand.dateAdded) {
      const t = new Date(cand.dateAdded).getTime();
      if (noteStarts.some((n) => n.contactId === cand.contactId && Math.abs(n.startMs - t) < 8 * 60_000)) {
        junkIds.add(cand.messageId);
        summary.skipped++;
        continue;
      }
    }
    // Known-short by metadata — free classification, register + skip forever.
    // Runs BEFORE the budget gate so even a flooded run still registers the
    // whole window in one pass (no details entry — there can be thousands).
    if (cand.durationSec != null && cand.durationSec < minDuration) {
      junkIds.add(cand.messageId);
      summary.skipped++;
      continue;
    }
    // Budget exhausted: defer WITHOUT touching the DB. Only candidates that
    // still need DB/API work ever defer — the free checks above already ran.
    if (overBudget()) {
      noteDeferred(cand);
      budgetDeferred++;
      summary.skipped++;
      continue;
    }
    // Cheap dedup before any API-heavy work.
    const { data: existing } = await admin
      .from("calls")
      .select("id, external_contact_id, transcript_status, recording_path")
      .eq("company_id", integration.company_id)
      .eq("imported_from", integration.provider)
      .eq("external_id", cand.messageId)
      .maybeSingle();
    if (existing) {
      summary.duplicates++;
      // Backfill the GHL contact id on rows created before we stored it, so
      // the seller name can deep-link to the contact.
      if (cand.contactId && !(existing as any).external_contact_id) {
        await admin
          .from("calls")
          .update({ external_contact_id: cand.contactId })
          .eq("id", existing.id);
      }
      // A call previously created "awaiting audio" heals itself the moment
      // WAVV posts the transcript note: attach the transcript and score.
      // (WAVV posts the transcript minutes after the call, usually after the
      // sync has already created the call — this branch is the common path.)
      const ts = String((existing as any).transcript_status ?? "");
      if (ts !== "ready" && processedHeavy < MAX_NEW_CALLS_PER_RUN && !overBudget()) {
        const tn = findTranscriptFor(cand);
        // No transcript note, but WAVV audio is reachable (working API key):
        // transcribe + score the awaiting-audio call right here, inside the
        // run's heavy slots. This is what actually drains "Upload" rows now —
        // the post-run piggyback rarely gets time on busy days.
        const rp = String((existing as any).recording_path ?? "");
        if (!tn && (rp.startsWith("wavv:") || cand.wavvUuid)) {
          processedHeavy++;
          try {
            if (!rp.startsWith("wavv:") && cand.wavvUuid) {
              await admin
                .from("calls")
                .update({ recording_path: `wavv:${cand.wavvUuid}` })
                .eq("id", existing.id);
            }
            const res = await processCallMedia(admin, existing.id, { autoScore: cfg.auto_score ?? true });
            summary.details.push({
              external_id: cand.messageId,
              status: res.error ? "failed" : "processed",
              detail: res.error
                ? `audio heal failed: ${String(res.error).slice(0, 160)}`
                : `transcribed from WAVV audio; scored=${res.scored}`,
            });
            if (res.error) summary.failed++;
          } catch (err: any) {
            summary.failed++;
            summary.details.push({
              external_id: cand.messageId,
              status: "failed",
              detail: `audio heal failed: ${String(err?.message ?? err).slice(0, 160)}`,
            });
          }
          continue;
        }
        if (tn) {
          processedHeavy++;
          usedTranscriptNoteIds.add(tn.noteId);
          try {
            await admin.from("transcripts").delete().eq("call_id", existing.id);
            await admin.from("transcripts").insert({
              call_id: existing.id,
              company_id: integration.company_id,
              content: tn.text,
              word_count: tn.wordCount,
              source: "provider",
            });
            await admin
              .from("calls")
              .update({ transcript_status: "ready" })
              .eq("id", existing.id);
            await processCallMedia(admin, existing.id, { autoScore: cfg.auto_score ?? true });
            summary.details.push({
              external_id: cand.messageId,
              status: "processed",
              detail: `transcript attached from WAVV note (${tn.wordCount} words); scored`,
            });
          } catch (err: any) {
            summary.failed++;
            summary.details.push({
              external_id: cand.messageId,
              status: "failed",
              detail: `transcript-note attach failed: ${String(err?.message ?? err).slice(0, 200)}`,
            });
          }
        }
      }
      continue;
    }

    // Cross-source dedup: since WAVV's integration update, the SAME dialer call
    // arrives TWICE — as a GHL call message (timestamped at call START) and as
    // a WAVV note (timestamped when the note posts, minutes AFTER the call
    // ends). External ids differ, so the id-based dedup above can't see it and
    // every call showed up doubled. Match on contact + estimated call start
    // instead: for a note candidate, start = note time − duration. A +/-8-min
    // window can never swallow a genuine follow-up call, because created calls
    // are all >=10 min long — the next real call starts >=10 min later.
    if (cand.contactId && cand.dateAdded) {
      const candStartMs =
        new Date(cand.dateAdded).getTime() -
        (cand.source === "note" ? (cand.durationSec ?? 0) * 1000 : 0);
      const { data: twin } = await admin
        .from("calls")
        .select("id, recording_path, transcript_status")
        .eq("company_id", integration.company_id)
        .eq("external_contact_id", cand.contactId)
        .gte("call_datetime", new Date(candStartMs - 8 * 60_000).toISOString())
        .lte("call_datetime", new Date(candStartMs + 8 * 60_000).toISOString())
        .limit(1)
        .maybeSingle();
      if (twin) {
        // Same call from the other source. If this side carries the WAVV uuid
        // and the twin still lacks usable audio, gift it the uuid so the
        // stuck-retry can transcribe + score it.
        if (
          cand.wavvUuid &&
          twin.transcript_status !== "ready" &&
          !String(twin.recording_path ?? "").startsWith("wavv:")
        ) {
          await admin
            .from("calls")
            .update({ recording_path: `wavv:${cand.wavvUuid}` })
            .eq("id", twin.id);
        }
        junkIds.add(cand.messageId); // never re-evaluate this shadow copy
        summary.duplicates++;
        summary.details.push({
          external_id: cand.messageId,
          status: "skipped",
          detail: "same call from the other source (message+note pair)",
        });
        continue;
      }
    }

    if (processedHeavy >= MAX_NEW_CALLS_PER_RUN || overBudget()) {
      noteDeferred(cand);
      summary.skipped++;
      summary.details.push({
        external_id: cand.messageId,
        status: "deferred",
        detail: overBudget()
          ? "run budget reached; next run will pick it up"
          : "per-run cap reached; next run will pick it up",
      });
      continue;
    }
    processedHeavy++;

    try {
      // 3a) Transcript note first (WAVV "transcription to notes"): if the
      // call's transcript is already in a contact note, ingest + score with
      // NO audio download and NO Deepgram at all.
      const tnote = findTranscriptFor(cand);
      if (tnote && cand.durationSec != null && cand.durationSec >= minDuration) {
        usedTranscriptNoteIds.add(tnote.noteId);
        const contact = cand.contactId
          ? await lookupContact(opts_, contactCache, cand.contactId)
          : null;
        const repHints: string[] = [];
        for (const uid of [cand.userId, pick(contact, "assignedTo", "assigned_to", "assignedUserId")]) {
          if (!uid) continue;
          repHints.push(String(uid));
          const email = await lookupUserEmail(opts_, userEmailCache, String(uid));
          if (email) repHints.push(email);
        }
        const norm: NormalizedInboundCall = {
          externalId: cand.messageId,
          callDatetime: callStartIso(cand),
          direction: cand.direction,
          durationSec: cand.durationSec,
          repHints,
          sellerName:
            pick(contact, "name", "fullName") ??
            [pick(contact, "firstName"), pick(contact, "lastName")].filter(Boolean).join(" ") ??
            null,
          sellerPhone: pick(contact, "phone") ?? null,
          propertyAddress: pick(contact, "address1", "fullAddress") ?? null,
          leadSource: srcTagOf(contact) ?? pick(contact, "source") ?? null,
          externalContactId: cand.contactId,
          recordingUrl: cand.attachmentUrl ?? (cand.wavvUuid ? `wavv:${cand.wavvUuid}` : null),
          transcript: tnote.text,
        };
        const outcome = await ingestNormalizedCall(admin, integration, norm);
        summary.details.push({
          external_id: cand.messageId,
          status: outcome.status,
          detail:
            outcome.status === "created"
              ? `created from WAVV transcript note (${tnote.wordCount} words); scoring`
              : outcome.detail,
        });
        if (outcome.status === "created") {
          summary.created++;
          if (outcome.callId) {
            await processCallMedia(admin, outcome.callId, { autoScore: cfg.auto_score ?? true });
          }
        } else if (outcome.status === "duplicate") summary.duplicates++;
        else if (outcome.status === "failed") summary.failed++;
        else summary.skipped++;
        continue;
      }

      // 3) Recording → Deepgram transcript. WAVV dialer calls carry the
      // recording as a public MP3 attachment on the message; the GHL
      // recording endpoint (which 422s for WAVV calls) is the fallback.
      let rec = cand.attachmentUrl ? await downloadRecordingFromUrl(cand.attachmentUrl) : null;
      // Aug-7+ WAVV notes carry no MP3 URL — the WAVV API is the recording
      // source of record for dialer calls now.
      if (!rec && cand.wavvUuid && wavvConfigured()) rec = await fetchWavvRecording(cand.wavvUuid);
      if (!rec && cand.source === "message") rec = await downloadRecording(opts_, cand.messageId);
      if (!rec) {
        processedHeavy--; // a recording-less message shouldn't consume a heavy slot

        // A WAVV call with a known qualifying duration is still a REAL call —
        // create it now (visible in the app, correct rep/time/duration) with
        // recording_path "wavv:<uuid>" so processCallMedia can transcribe and
        // score it automatically once the WAVV API becomes reachable.
        if (cand.wavvUuid && cand.durationSec != null && cand.durationSec >= minDuration) {
          const contact = cand.contactId
            ? await lookupContact(opts_, contactCache, cand.contactId)
            : null;
          const repHints: string[] = [];
          for (const uid of [cand.userId, pick(contact, "assignedTo", "assigned_to", "assignedUserId")]) {
            if (!uid) continue;
            repHints.push(String(uid));
            const email = await lookupUserEmail(opts_, userEmailCache, String(uid));
            if (email) repHints.push(email);
          }
          const norm: NormalizedInboundCall = {
            externalId: cand.messageId,
            callDatetime: callStartIso(cand),
            direction: cand.direction,
            durationSec: cand.durationSec,
            repHints,
            sellerName:
              pick(contact, "name", "fullName") ??
              [pick(contact, "firstName"), pick(contact, "lastName")].filter(Boolean).join(" ") ??
              null,
            sellerPhone: pick(contact, "phone") ?? null,
            propertyAddress: pick(contact, "address1", "fullAddress") ?? null,
            leadSource: srcTagOf(contact) ?? pick(contact, "source") ?? null,
            externalContactId: cand.contactId,
            recordingUrl: `wavv:${cand.wavvUuid}`,
            transcript: null,
          };
          const outcome = await ingestNormalizedCall(admin, integration, norm);
          if (outcome.status === "created") summary.created++;
          else if (outcome.status === "duplicate") summary.duplicates++;
          else summary.skipped++;
          summary.details.push({
            external_id: cand.messageId,
            status: outcome.status,
            detail:
              outcome.status === "created"
                ? "created awaiting WAVV audio (will transcribe+score when API access works)"
                : outcome.detail,
          });
          continue;
        }

        summary.skipped++;
        summary.details.push({
          external_id: cand.messageId,
          status: "skipped",
          detail:
            cand.wavvUuid && !wavvConfigured()
              ? "WAVV note has no recording URL and WAVV_API_KEY is not set"
              : "no recording available",
        });
        continue;
      }
      // A >=10-min call is >=~500KB at any sane bitrate. When the message
      // carries no duration metadata, a tiny file is a junk clip (voicemail
      // beep, dropped call) — skip it BEFORE paying for transcription, and
      // refund the heavy slot so real calls aren't starved. Without this,
      // three tiny GHL-native clips per run consumed every heavy slot,
      // deferred all real calls, and pinned the cursor (Aug 21-22 livelock).
      if (cand.durationSec == null && rec.bytes.byteLength < 500_000) {
        processedHeavy--;
        junkIds.add(cand.messageId); // never probe this clip again
        summary.skipped++;
        summary.details.push({
          external_id: cand.messageId,
          status: "skipped",
          detail: `recording ${(rec.bytes.byteLength / 1024).toFixed(0)}KB — too small for a ${minDuration}s call`,
        });
        continue;
      }
      const t = await transcribeRecordingBuffer(rec.bytes, rec.contentType);
      if (t.durationSec != null && t.durationSec < minDuration) {
        processedHeavy--; // short call, no scoring done — refund the slot
        junkIds.add(cand.messageId); // duration is final — never probe again
        summary.skipped++;
        summary.details.push({
          external_id: cand.messageId,
          status: "skipped",
          detail: `recording ${t.durationSec}s < min ${minDuration}s`,
        });
        continue;
      }

      // 4) Rep + contact enrichment. WAVV notes often carry no usable userId,
      // so the contact's assigned user (the dialing rep owns their leads) is
      // the primary attribution signal.
      const contact = cand.contactId
        ? await lookupContact(opts_, contactCache, cand.contactId)
        : null;
      const repHints: string[] = [];
      for (const uid of [cand.userId, pick(contact, "assignedTo", "assigned_to", "assignedUserId")]) {
        if (!uid) continue;
        repHints.push(String(uid));
        const email = await lookupUserEmail(opts_, userEmailCache, String(uid));
        if (email) repHints.push(email);
      }

      const norm: NormalizedInboundCall = {
        externalId: cand.messageId,
        callDatetime: callStartIso(cand),
        direction: cand.direction,
        durationSec: cand.durationSec ?? t.durationSec ?? null,
        repHints,
        sellerName:
          pick(contact, "name", "fullName") ??
          [pick(contact, "firstName"), pick(contact, "lastName")].filter(Boolean).join(" ") ??
          null,
        sellerPhone: pick(contact, "phone") ?? null,
        propertyAddress: pick(contact, "address1", "fullAddress") ?? null,
        leadSource: srcTagOf(contact) ?? pick(contact, "source") ?? null,
        externalContactId: cand.contactId,
        recordingUrl: cand.attachmentUrl, // playable WAVV MP3 when present
        transcript: t.formatted,
      };

      const outcome = await ingestNormalizedCall(admin, integration, norm);
      summary.details.push({
        external_id: cand.messageId,
        status: outcome.status,
        detail: outcome.detail,
      });
      if (outcome.status === "created") {
        summary.created++;
        if (outcome.callId) {
          const autoScore = cfg.auto_score ?? true;
          await processCallMedia(admin, outcome.callId, { autoScore });
        }
      } else if (outcome.status === "duplicate") {
        summary.duplicates++;
      } else if (outcome.status === "failed") {
        summary.failed++;
      } else {
        summary.skipped++;
      }
    } catch (err: any) {
      summary.failed++;
      summary.details.push({
        external_id: cand.messageId,
        status: "failed",
        detail: err?.message?.slice(0, 300),
      });
    }
  }

  // 5) Advance the cursor — but never past a call the per-run cap deferred,
  // so the backlog drains across runs instead of being dropped. Targeted
  // single-contact runs leave the cursor untouched.
  if (!opts.contactId) {
    // Never pin the cursor further back than the candidate horizon — a
    // permanently-deferred stale candidate once froze the cursor for days,
    // which ballooned the scan window until every run timed out.
    const cursorFloorMs = now - CANDIDATE_LOOKBACK_MS;
    let newCursor = oldestDeferredIso ?? new Date(now).toISOString();
    if (new Date(newCursor).getTime() < cursorFloorMs) {
      newCursor = new Date(cursorFloorMs).toISOString();
    }
    summary.cursor = newCursor;
    await admin
      .from("integrations")
      .update({
        config_json: {
          ...cfg,
          pull_cursor_iso: newCursor,
          ghl_location_id: locationId,
          // Junk registry. Cap must exceed the 48h candidate volume — WAVV's
          // message+note double-logging pushed candidates past 2400/run and
          // the old 800 cap thrashed (entries evicted while still in-window).
          pull_junk_ids: [...junkIds].slice(-4000),
        },
        last_sync_at: newCursor,
      })
      .eq("id", integration.id);
  }

  console.log(
    `[pull] done ${Date.now() - runStarted}ms: created=${summary.created} dup=${summary.duplicates} skipped=${summary.skipped} failed=${summary.failed} junkKnown=${junkSkips} budgetDeferred=${budgetDeferred} cursor=${summary.cursor ?? "(unchanged)"}`
  );
  return summary;
}
