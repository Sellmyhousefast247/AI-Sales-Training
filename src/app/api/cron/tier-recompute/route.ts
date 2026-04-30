import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { computeRepTier } from "@/lib/tier";
import type { RollingWindow } from "@/lib/types";

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data: companies } = await admin.from("companies").select("id");
  let updated = 0;

  for (const c of companies ?? []) {
    const { data: settings } = await admin
      .from("company_settings")
      .select("rolling_window, min_calls_to_leave_tier1")
      .eq("company_id", c.id)
      .maybeSingle();
    const window: RollingWindow = (settings?.rolling_window as RollingWindow) ?? "last_10";
    const minCalls = settings?.min_calls_to_leave_tier1 ?? 5;

    const { data: reps } = await admin
      .from("reps")
      .select("id, current_tier")
      .eq("company_id", c.id)
      .eq("is_active", true);

    for (const rep of reps ?? []) {
      const { data: scores } = await admin
        .from("scorecards")
        .select("average_score, created_at")
        .eq("rep_id", rep.id)
        .eq("is_current", true);

      const result = computeRepTier({
        scores: (scores ?? []).map((s: any) => ({
          average_score: Number(s.average_score),
          created_at: s.created_at,
        })),
        window,
        minCallsToLeaveTier1: minCalls,
      });

      await admin
        .from("reps")
        .update({ current_tier: result.tier, current_avg_score: result.rolling_avg })
        .eq("id", rep.id);

      if (result.tier !== rep.current_tier) {
        await admin.from("tier_history").insert({
          company_id: c.id,
          rep_id: rep.id,
          old_tier: rep.current_tier,
          new_tier: result.tier,
          avg_score_at_change: result.rolling_avg,
          window_used: window,
          reason: `Nightly recompute: ${result.rolling_avg ?? "n/a"} on ${result.sample_size} calls`,
        });
        updated += 1;
      }
    }
  }

  return NextResponse.json({ ok: true, tier_changes: updated });
}
