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

/** List team calls, newest first. `startedAfterIso` bounds the window. */
export async function listWavvCalls(
  startedAfterIso: string,
  maxPages = 5
): Promise<WavvCall[]> {
  const out: WavvCall[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ startedAfter: startedAfterIso, limit: "200" });
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
        out.push({ path: `${path} [${styleName}] keyLen=${key.length}`, status: resp.status, snippet: text });
      } catch {
        out.push({ path: `${path} [${styleName}]`, status: "network-error", snippet: "" });
      }
    }
  }
  return out;
}
