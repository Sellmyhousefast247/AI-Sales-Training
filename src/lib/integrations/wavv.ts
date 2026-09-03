/**
 * WAVV Public API v3 client (docs.wavv.com).
 *
 * WHY THIS EXISTS: WAVV's GHL integration used to embed a public MP3 URL in
 * each call note (https://file.wavv.com/recordings/<hash>/<phone>.mp3). Around
 * 2026-08-07 the note format dropped the URL — WAVV's API is now the
 * recording source of record for dialer calls.
 *
 * API shape (confirmed against docs.wavv.com, 2026-08-10):
 *   Base:  https://api.wavv.com/v3   ·   Auth: `Authorization: Bearer <key>`
 *   GET /calls?startedAfter=&startedBefore=&cursor=&limit=  → { data: Call[], nextCursor }
 *   GET /calls/{id}            → Call { id, direction, phone, contactId,
 *                                contactName, startedAt, seconds, disposition,
 *                                recorded, note, summary, … }
 *   GET /calls/{id}/recording  → { url, expiresAt } (freshly signed audio URL)
 * The {id} uuid matches the `[ WAVV: <uuid> ]` marker in GHL contact notes.
 *
 * Configuration (Vercel env on the ai-sales-training-7sok project):
 *   WAVV_API_KEY   — Call Logs API key from WAVV Manager → Integrations
 *   WAVV_API_BASE  — optional override (default https://api.wavv.com/v3)
 */

const BASE = process.env.WAVV_API_BASE || "https://api.wavv.com/v3";

/** Env values pasted via dashboards sometimes carry stray whitespace/quotes. */
function apiKey(): string | null {
  const raw = process.env.WAVV_API_KEY;
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^['"]+|['"]+$/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

export function wavvConfigured(): boolean {
  return Boolean(apiKey());
}

async function wavvJson(path: string): Promise<{ status: number; data: any } | null> {
  const key = apiKey();
  if (!key) return null;
  try {
    const resp = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    let data: any = null;
    const ctype = (resp.headers.get("content-type") ?? "").toLowerCase();
    if (ctype.includes("json")) {
      try {
        data = await resp.json();
      } catch {
        data = null;
      }
    }
    return { status: resp.status, data };
  } catch {
    return null;
  }
}

export interface WavvCall {
  id: string;
  direction?: string;
  phone?: string;
  contactId?: string;
  contactName?: string;
  startedAt?: string;
  seconds?: number;
  disposition?: string;
  recorded?: boolean;
}

/** Normalize a phone to its last 10 digits for matching (strips +1, spaces). */
function last10(phone: unknown): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-10);
}

/**
 * List team calls for ONE direction, newest first. WAVV v3 REQUIRES the
 * `direction` param (inbound|outbound) — a bare /calls now 400s, which had
 * silently disabled the older list-based recovery.
 */
export async function listWavvCalls(
  direction: "inbound" | "outbound",
  maxPages = 5
): Promise<WavvCall[]> {
  const out: WavvCall[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ direction, limit: "50" });
    if (cursor) qs.set("cursor", cursor);
    const resp = await wavvJson(`/calls?${qs.toString()}`);
    if (!resp || resp.status !== 200 || !Array.isArray(resp.data?.data)) break;
    out.push(...(resp.data.data as WavvCall[]));
    cursor = resp.data?.nextCursor ?? null;
    if (!cursor) break;
  }
  return out;
}

/**
 * Recover a call id when the GHL note's `[ WAVV: <uuid> ]` is NOT a valid WAVV
 * API call id — which is the case for INBOUND (seller-callback) calls: their
 * note uuid 404s on /calls/{id}, but the real recorded call is in the WAVV
 * call list. Match by the contact's phone (last 10 digits) closest in time to
 * the call, within a window, preferring a recorded call. Searches inbound
 * first (the common case for a bad note uuid), then outbound.
 */
export async function findRecordedWavvCallId(
  phone: string | null,
  aroundIso: string | null,
  windowMin = 20
): Promise<string | null> {
  const want = last10(phone);
  if (!want || !aroundIso) return null;
  const anchor = new Date(aroundIso).getTime();
  if (Number.isNaN(anchor)) return null;
  let best: { id: string; delta: number; recorded: boolean } | null = null;
  for (const dir of ["inbound", "outbound"] as const) {
    for (const c of await listWavvCalls(dir)) {
      if (last10(c.phone) !== want || !c.startedAt || !c.id) continue;
      const delta = Math.abs(new Date(c.startedAt).getTime() - anchor);
      if (delta > windowMin * 60_000) continue;
      const rec = Boolean(c.recorded);
      // Prefer a recorded call; among those, the closest in time.
      if (!best || (rec && !best.recorded) || (rec === best.recorded && delta < best.delta)) {
        best = { id: c.id, delta, recorded: rec };
      }
    }
    if (best?.recorded) break; // good enough — a recorded match in this direction
  }
  return best?.recorded ? best.id : null;
}

/**
 * Fetch the recording audio for a WAVV call uuid:
 * GET /calls/{id}/recording → signed URL → download bytes.
 */
export async function fetchWavvRecording(
  uuid: string
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const resp = await wavvJson(`/calls/${uuid}/recording`);
  const url = resp?.data?.url;
  if (typeof url !== "string" || !url.startsWith("http")) return null;
  try {
    const audio = await fetch(url);
    if (!audio.ok) return null;
    const bytes = await audio.arrayBuffer();
    if (bytes.byteLength === 0) return null;
    return { bytes, contentType: audio.headers.get("content-type") ?? "audio/mpeg" };
  } catch {
    return null;
  }
}

/**
 * Diagnostics for /api/debug/wavv: exercises the real v3 endpoints and
 * reports status + sanitized snippets. Never echoes the key.
 */
export async function wavvProbe(uuid?: string | null): Promise<
  Array<{ path: string; status: number | string; snippet: string }>
> {
  const key = apiKey();
  if (!key) return [{ path: "-", status: "WAVV_API_KEY not set", snippet: "" }];

  const paths = uuid
    ? [`/calls/${uuid}`, `/calls/${uuid}/recording`]
    : [`/calls?limit=3`];

  // Auth-style matrix: docs say Bearer, but a 401 with a known-good key means
  // it's worth confirming the server doesn't expect a different header.
  const styles: Array<[string, Record<string, string>]> = [
    ["bearer", { Authorization: `Bearer ${key}` }],
    ["x-api-key", { "X-Api-Key": key }],
    ["api-key-hdr", { "Api-Key": key }],
    ["raw-auth", { Authorization: key }],
    ["basic", { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` }],
  ];

  const out: Array<{ path: string; status: number | string; snippet: string }> = [];
  for (const path of paths) {
    for (const [styleName, headers] of styles) {
      try {
        const resp = await fetch(`${BASE}${path}`, {
          headers: { ...headers, Accept: "application/json" },
        });
        const text = (await resp.text()).slice(0, 300).replace(new RegExp(key, "g"), "***");
        // keyPrefix: first 6 chars only — the WAVV Manager key list already
        // displays the first 10 openly, so this identifies WHICH key is
        // deployed without exposing secret material.
        out.push({
          path: `${path} [${styleName}] keyLen=${key.length} keyPrefix=${key.slice(0, 6)}`,
          status: resp.status,
          snippet: text,
        });
      } catch {
        out.push({ path: `${path} [${styleName}]`, status: "network-error", snippet: "" });
      }
    }
  }
  return out;
}
