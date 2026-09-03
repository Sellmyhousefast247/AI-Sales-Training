import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * GET /api/debug/wavv — CRON_SECRET-protected discovery probe (read-only).
 *
 * Disambiguates WAVV auth: for each candidate base URL, calls GET /calls with
 * (a) the real key raw in Authorization, (b) a GARBAGE key raw, (c) the real
 * key as Bearer. If (a) and (b) differ, the server validates the raw key —
 * i.e. auth works without the Bearer prefix — and the path/base giving a
 * non-404 with (a) is the real API surface.
 * Pass ?uuid=<wavv call uuid> to hit /calls/<uuid>/transcript instead.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const key = (process.env.WAVV_API_KEY ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!key) return NextResponse.json({ error: "WAVV_API_KEY not set" }, { status: 500 });

  // ?path=/calls?direction=inbound&limit=10 — raw v3 probe with the real
  // Bearer key only. For exploring how inbound-call recordings are addressed.
  const rawPath = req.nextUrl.searchParams.get("path");
  if (rawPath && rawPath.startsWith("/")) {
    try {
      const resp = await fetch(`https://api.wavv.com/v3${rawPath}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
      const text = (await resp.text()).replace(new RegExp(key, "g"), "***").slice(0, 4000);
      return NextResponse.json({ path: rawPath, status: resp.status, body: text });
    } catch (err: any) {
      return NextResponse.json({ path: rawPath, status: "ERR", body: String(err?.message ?? err).slice(0, 200) });
    }
  }

  const uuid = req.nextUrl.searchParams.get("uuid");
  const bases = [
    "https://api.wavv.com/v3",
    "https://api.wavv.com",
    "https://api.wavv.com/v1",
    "https://api.wavv.com/v2",
    "https://api.wavv.com/public/v3",
    "https://api.wavv.com/api/v3",
  ];
  const path = uuid ? `/calls/${uuid}/transcript` : `/calls?limit=1`;
  const styles: Array<[string, string]> = [
    ["raw-real", key],
    ["raw-garbage", "garbagekey_0000000000000000000000000000000000000000000000000000"],
    ["bearer-real", `Bearer ${key}`],
  ];

  const results: Array<{ base: string; style: string; status: number | string; snippet: string }> = [];
  for (const base of bases) {
    for (const [style, headerVal] of styles) {
      try {
        const resp = await fetch(`${base}${path}`, {
          headers: { Authorization: headerVal, Accept: "application/json" },
        });
        const text = (await resp.text()).slice(0, 200).replace(new RegExp(key, "g"), "***");
        results.push({ base, style, status: resp.status, snippet: text });
      } catch (err: any) {
        results.push({ base, style, status: "ERR", snippet: String(err?.message ?? err).slice(0, 120) });
      }
    }
  }
  return NextResponse.json({ keyLen: key.length, keyPrefix: key.slice(0, 6), path, results });
}
