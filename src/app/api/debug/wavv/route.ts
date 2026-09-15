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

  // ?sweep=1&startedAfter=<iso>[&startedBefore=<iso>][&minSeconds=900]
  // Pages BOTH directions server-side (limit 200/page) and returns a compact
  // list of calls at/above minSeconds — "did the dialer see any long call the
  // app didn't?" without hand-paginating 5-per-page through the debug probe.
  if (req.nextUrl.searchParams.get("sweep")) {
    const sp = req.nextUrl.searchParams;
    const startedAfter = sp.get("startedAfter");
    if (!startedAfter) return NextResponse.json({ error: "startedAfter required (ISO)" }, { status: 400 });
    const startedBefore = sp.get("startedBefore");
    const minSeconds = Number(sp.get("minSeconds") ?? 900);
    const deadline = Date.now() + 95_000;
    const out: any[] = [];
    const byUser: Record<string, { calls: number; longCalls: number; totalSeconds: number; names: Set<string> }> = {};
    let pages = 0, scanned = 0, truncated = false;
    for (const direction of ["outbound", "inbound"]) {
      let cursor: string | null = null;
      for (;;) {
        if (Date.now() > deadline) { truncated = true; break; }
        const qs = new URLSearchParams({ direction, limit: "200", startedAfter });
        if (startedBefore) qs.set("startedBefore", startedBefore);
        if (cursor) qs.set("cursor", cursor);
        const resp = await fetch(`https://api.wavv.com/v3/calls?${qs}`, {
          headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        });
        if (!resp.ok) {
          return NextResponse.json({ error: `wavv ${resp.status}`, body: (await resp.text()).slice(0, 300), direction, pages });
        }
        const body = (await resp.json()) as { data?: any[]; nextCursor?: string | null };
        pages++;
        for (const c of body.data ?? []) {
          scanned++;
          const u = String(c.userId ?? "?");
          const agg = (byUser[u] ??= { calls: 0, longCalls: 0, totalSeconds: 0, names: new Set() });
          agg.calls++;
          agg.totalSeconds += Number(c.seconds ?? 0);
          if (Number(c.seconds ?? 0) >= minSeconds) {
            agg.longCalls++;
            if (c.contactName) agg.names.add(String(c.contactName));
            out.push({
              id: c.id, direction: c.direction, userId: c.userId, callerId: c.callerId,
              contactName: c.contactName ?? null, phone: c.phone, startedAt: c.startedAt,
              seconds: c.seconds, recorded: c.recorded, outcome: c.outcome ?? null,
            });
          }
        }
        cursor = body.nextCursor ?? null;
        if (!cursor) break;
      }
    }
    out.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    const users = Object.fromEntries(
      Object.entries(byUser).map(([u, a]) => [u, { ...a, names: [...a.names].slice(0, 12) }])
    );
    return NextResponse.json({ startedAfter, startedBefore, minSeconds, pages, scanned, truncated, users, longCalls: out });
  }

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
