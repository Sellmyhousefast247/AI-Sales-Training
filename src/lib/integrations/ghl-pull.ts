import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationRow, NormalizedInboundCall } from "./types";
import { ingestNormalizedCall, processCallMedia } from "./ingest";
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
  if (resp.status === 404 || resp.status === 422) return null;
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
  const urlMatch = body.match(/https:\/\/file\.wavv\.com\/recordings\/[^\s"'<>)\]]+/i);
  if (!urlMatch) return null;
  const wavvId = body.match(/\[\s*WAVV:\s*([0-9a-f-]{10,})\s*\]/i)?.[1] ?? null;
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
    attachmentUrl: urlMatch[0],
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
  opts: { lookbackHours?: number | null } = {}
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
  const cursorIso: string | null = cfg.pull_cursor_iso ?? null;
  // Conversation-scan window: explicit lookback override (deep sweeps), else
  // cursor minus a generous overlap for WAVV's late syncs.
  const sinceMs = opts.lookbackHours
    ? now - opts.lookbackHours * 60 * 60 * 1000
    : cursorIso
      ? new Date(cursorIso).getTime() - OVERLAP_MS
      : now - INITIAL_LOOKBACK_MS;
  // Candidate window: never narrower than 48h — backdated call messages must
  // still qualify even when the scan cursor is fresh. Dedup keeps this cheap.
  const candidateSinceMs = Math.min(sinceMs, now - CANDIDATE_LOOKBACK_MS);

  // 1) Recently-active conversations, newest first, paginated — SMS blasts
  // can push a call conversation far down the recent list.
  const conversations: any[] = [];
  let startAfterDate: number | null = null;
  for (let page = 0; page < MAX_CONVERSATION_PAGES; page++) {
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
  const noteContactIds = [
    ...new Set(candidates.map((c) => c.contactId).filter(Boolean) as string[]),
  ];
  let notesDenied = 0;
  for (const cid of noteContactIds) {
    let notes: any[] = [];
    try {
      const data: any = await ghlJson(opts_, `/contacts/${cid}/notes`, CONTACTS_VERSION);
      notes = data?.notes ?? data ?? [];
    } catch (err: any) {
      if (String(err?.message ?? "").includes(" 401") || String(err?.message ?? "").includes(" 403")) notesDenied++;
      continue;
    }
    if (!Array.isArray(notes)) continue;
    for (const note of notes) {
      const cand = noteToCandidate(cid, note);
      if (!cand) continue;
      if (cand.dateAdded && new Date(cand.dateAdded).getTime() < candidateSinceMs) continue;
      candidates.push(cand);
    }
  }
  if (notesDenied > 0) {
    summary.details.push({
      external_id: "(scope)",
      status: "failed",
      detail: `notes API denied for ${notesDenied} contacts — add the View Contact Notes scope to the Private Integration`,
    });
  }
  summary.candidate_calls = candidates.length;

  // Oldest first so the cursor can advance monotonically.
  candidates.sort((a, b) =>
    String(a.dateAdded ?? "").localeCompare(String(b.dateAdded ?? ""))
  );

  const userEmailCache = new Map<string, string | null>();
  const contactCache = new Map<string, any>();
  const minDuration = cfg.min_duration_sec ?? 30;
  let processedHeavy = 0;
  /** Oldest call deferred by the per-run cap — the cursor must not pass it. */
  let oldestDeferredIso: string | null = null;

  for (const cand of candidates) {
    // Cheap dedup before any API-heavy work.
    const { data: existing } = await admin
      .from("calls")
      .select("id")
      .eq("company_id", integration.company_id)
      .eq("imported_from", integration.provider)
      .eq("external_id", cand.messageId)
      .maybeSingle();
    if (existing) {
      summary.duplicates++;
      continue;
    }

    if (cand.durationSec != null && cand.durationSec < minDuration) {
      summary.skipped++;
      summary.details.push({
        external_id: cand.messageId,
        status: "skipped",
        detail: `duration ${cand.durationSec}s < min ${minDuration}s`,
      });
      continue;
    }

    if (processedHeavy >= MAX_NEW_CALLS_PER_RUN) {
      if (!oldestDeferredIso && cand.dateAdded) oldestDeferredIso = cand.dateAdded;
      summary.skipped++;
      summary.details.push({
        external_id: cand.messageId,
        status: "deferred",
        detail: "per-run cap reached; next run will pick it up",
      });
      continue;
    }
    processedHeavy++;

    try {
      // 3) Recording → Deepgram transcript. WAVV dialer calls carry the
      // recording as a public MP3 attachment on the message; the GHL
      // recording endpoint (which 422s for WAVV calls) is the fallback.
      let rec = cand.attachmentUrl ? await downloadRecordingFromUrl(cand.attachmentUrl) : null;
      if (!rec && cand.source === "message") rec = await downloadRecording(opts_, cand.messageId);
      if (!rec) {
        processedHeavy--; // a recording-less message shouldn't consume a heavy slot
        summary.skipped++;
        summary.details.push({
          external_id: cand.messageId,
          status: "skipped",
          detail: "no recording on message",
        });
        continue;
      }
      const t = await transcribeRecordingBuffer(rec.bytes, rec.contentType);
      if (t.durationSec != null && t.durationSec < minDuration) {
        summary.skipped++;
        summary.details.push({
          external_id: cand.messageId,
          status: "skipped",
          detail: `recording ${t.durationSec}s < min ${minDuration}s`,
        });
        continue;
      }

      // 4) Rep + contact enrichment.
      const repHints: string[] = [];
      if (cand.userId) {
        repHints.push(cand.userId);
        const email = await lookupUserEmail(opts_, userEmailCache, cand.userId);
        if (email) repHints.push(email);
      }
      const contact = cand.contactId
        ? await lookupContact(opts_, contactCache, cand.contactId)
        : null;

      const norm: NormalizedInboundCall = {
        externalId: cand.messageId,
        callDatetime: cand.dateAdded,
        direction: cand.direction,
        durationSec: cand.durationSec ?? t.durationSec ?? null,
        repHints,
        sellerName:
          pick(contact, "name", "fullName") ??
          [pick(contact, "firstName"), pick(contact, "lastName")].filter(Boolean).join(" ") ??
          null,
        sellerPhone: pick(contact, "phone") ?? null,
        propertyAddress: pick(contact, "address1", "fullAddress") ?? null,
        leadSource: pick(contact, "source") ?? null,
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
  // so the backlog drains across runs instead of being dropped.
  const newCursor = oldestDeferredIso ?? new Date(now).toISOString();
  summary.cursor = newCursor;
  await admin
    .from("integrations")
    .update({
      config_json: { ...cfg, pull_cursor_iso: newCursor, ghl_location_id: locationId },
      last_sync_at: newCursor,
    })
    .eq("id", integration.id);

  return summary;
}
