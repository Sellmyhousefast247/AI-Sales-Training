import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * GET /api/debug/costs — CRON_SECRET-protected. Daily rollup of the app's own
 * recorded AI scoring spend (scorecards.cost_usd) for the last 14 days, so
 * "why is my card being charged" is answerable from the app's records.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
  const { data, error } = await admin
    .from("scorecards")
    .select("created_at, cost_usd, input_tokens, output_tokens, is_current")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const days: Record<
    string,
    { scorings: number; superseded: number; cost: number; inTok: number; outTok: number }
  > = {};
  for (const r of data ?? []) {
    const day = String(r.created_at).slice(0, 10);
    const d = (days[day] ??= { scorings: 0, superseded: 0, cost: 0, inTok: 0, outTok: 0 });
    d.scorings++;
    if (!r.is_current) d.superseded++;
    d.cost += Number(r.cost_usd ?? 0);
    d.inTok += Number(r.input_tokens ?? 0);
    d.outTok += Number(r.output_tokens ?? 0);
  }
  const rows = Object.entries(days)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, d]) => ({ day, ...d, cost: Math.round(d.cost * 100) / 100 }));
  return NextResponse.json({ note: "cost_usd covers COMPLETED scorings only — failed/timed-out attempts still bill Anthropic but are not recorded here", days: rows });
}
