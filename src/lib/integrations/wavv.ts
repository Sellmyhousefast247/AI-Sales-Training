/**
 * WAVV Call Logs API client.
 *
 * WHY THIS EXISTS: WAVV's GHL integration used to embed a public MP3 URL in
 * each call note (https://file.wavv.com/recordings/<hash>/<phone>.mp3). Around
 * 2026-08-07 the note format dropped the URL, and the hash isn't derivable
 * from the call uuid — so WAVV's own API is now the only recording source.
 *
 * WAVV's public API docs are not published, so this client is deliberately
 * flexible: it tries a small matrix of likely endpoint shapes and auth header
 * styles, remembers the first combination that works, and exposes a probe
 * (`wavvProbe`) that /api/debug/wavv uses to discover the real shape without
 * the key ever leaving the server.
 *
 * Configuration (Vercel env) — key added 2026-08-10:
 *   WAVV_API_KEY   — Call Logs API key from WAVV Manager → Integrations
 *   WAVV_API_BASE  — optional override, e.g. https://api.wavv.com
 */

const DEFAULT_BASES = [
  process.env.WAVV_API_BASE,
  "https://api.wavv.com",
  "https://api.wavv.com/v1",
  "https://api.wavv.com/v2",
].filter(Boolean) as string[];

type AuthStyle = "bearer" | "x-api-key" | "api-key" | "token";

const AUTH_STYLES: AuthStyle[] = ["bearer", "x-api-key", "api-key", "token"];

function authHeaders(style: AuthStyle, key: string): Record<string, string> {
  switch (style) {
    case "bearer":
      return { Authorization: `Bearer ${key}` };
    case "x-api-key":
      return { "X-Api-Key": key };
    case "api-key":
      return { "Api-Key": key };
    case "token":
      return { Authorization: `Token ${key}` };
  }
}

export function wavvConfigured(): boolean {
  return Boolean(process.env.WAVV_API_KEY);
}

/** First (base, auth) combo that returned a non-401/403/404; cached per lambda. */
let workingCombo: { base: string; style: AuthStyle } | null = null;

async function tryFetch(
  base: string,
  path: string,
  style: AuthStyle,
  key: string
): Promise<Response | null> {
  try {
    const resp = await fetch(`${base}${path}`, {
      headers: { ...authHeaders(style, key), Accept: "application/json, audio/*" },
    });
    return resp;
  } catch {
    return null;
  }
}

/**
 * Fetch the recording audio for a WAVV call uuid. Tries the cached working
 * combo first, then the discovery matrix. Follows a JSON body that carries a
 * recording URL. Returns null when nothing yields audio.
 */
export async function fetchWavvRecording(
  uuid: string
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const key = process.env.WAVV_API_KEY;
  if (!key) return null;

  const paths = [
    `/calls/${uuid}/recording`,
    `/call-logs/${uuid}/recording`,
    `/calls/${uuid}`,
    `/call-logs/${uuid}`,
    `/recordings/${uuid}`,
  ];

  const combos: Array<{ base: string; style: AuthStyle }> = workingCombo
    ? [workingCombo]
    : DEFAULT_BASES.flatMap((base) => AUTH_STYLES.map((style) => ({ base, style })));

  for (const combo of combos) {
    for (const path of paths) {
      const resp = await tryFetch(combo.base, path, combo.style, key);
      if (!resp) continue;
      if (resp.status === 401 || resp.status === 403) break; // wrong auth for this base
      if (!resp.ok) continue;

      workingCombo = combo;
      const ctype = (resp.headers.get("content-type") ?? "").toLowerCase();

      if (ctype.includes("audio") || ctype.includes("octet-stream")) {
        const bytes = await resp.arrayBuffer();
        if (bytes.byteLength > 0) return { bytes, contentType: ctype || "audio/mpeg" };
        continue;
      }

      if (ctype.includes("json")) {
        try {
          const data: any = await resp.json();
          const url =
            data?.recordingUrl ?? data?.recording_url ?? data?.url ??
            data?.recording?.url ?? data?.call?.recordingUrl ?? null;
          if (typeof url === "string" && url.startsWith("http")) {
            const audio = await fetch(url);
            if (audio.ok) {
              const bytes = await audio.arrayBuffer();
              if (bytes.byteLength > 0) {
                return {
                  bytes,
                  contentType: audio.headers.get("content-type") ?? "audio/mpeg",
                };
              }
            }
          }
        } catch {
          /* not the shape we hoped — keep probing */
        }
      }
    }
  }
  return null;
}

/**
 * Discovery probe used by /api/debug/wavv: hits the endpoint matrix and
 * reports status codes + a short sanitized body snippet per attempt so the
 * real API shape can be identified from outside. Never echoes the key.
 */
export async function wavvProbe(uuid?: string | null): Promise<
  Array<{ base: string; style: AuthStyle; path: string; status: number | string; snippet: string }>
> {
  const key = process.env.WAVV_API_KEY;
  if (!key) return [{ base: "-", style: "bearer", path: "-", status: "WAVV_API_KEY not set", snippet: "" }];

  const paths = uuid
    ? [`/calls/${uuid}`, `/calls/${uuid}/recording`, `/call-logs/${uuid}`, `/recordings/${uuid}`]
    : ["/calls", "/call-logs", "/callLogs", "/me", "/account", "/users"];

  const out: Array<{ base: string; style: AuthStyle; path: string; status: number | string; snippet: string }> = [];
  for (const base of DEFAULT_BASES) {
    for (const style of AUTH_STYLES) {
      for (const path of paths) {
        const resp = await tryFetch(base, path, style, key);
        if (!resp) {
          out.push({ base, style, path, status: "network-error", snippet: "" });
          continue;
        }
        let snippet = "";
        try {
          snippet = (await resp.text()).slice(0, 160).replace(new RegExp(key, "g"), "***");
        } catch {
          /* body unavailable */
        }
        out.push({ base, style, path, status: resp.status, snippet });
        // A 401/403 means this auth style is wrong for the whole base.
        if (resp.status === 401 || resp.status === 403) break;
      }
    }
  }
  return out;
}
