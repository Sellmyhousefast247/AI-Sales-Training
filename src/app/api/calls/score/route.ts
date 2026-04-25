import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { scoreCall } from "@/lib/ai/score-call";
import { computeRepTier, tierFromAverage } from "@/lib/tier";
import { SCORECARD_CATEGORIES, DISCOVERY_CHECKS, type RollingWindow } from "@/lib/types";

export const maxDuration = 90; // Vercel serverless: long enough for Claude scoring

const Body = z.object({
  call_id: z.string().uuid(),
  force: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Not signed in" } }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation_failed", message: parsed.error.message } }, { status: 400 });
  }
  const { call_id, force } = parsed.data;

  const userClient = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  // Load call + transcript + rep + company (RLS-scoped)
  const { data: call, error: callErr } = await userClient
    .from("calls")
    .select(`
      id, company_id, rep_id, call_datetime, call_type, lead_source, seller_name,
      reps:rep_id (full_name),
      companies:company_id (name),
      transcripts:transcripts!transcripts_call_id_fkey (content)
    `)
    .eq("id", call_id)
    .single();

  if (callErr || !call) {
    return NextResponse.json({ error: { code: "not_found", message: "Call not found" } }, { status: 404 });
  }

  if (call.company_id !== profile.company_id && profile.role !== "super_admin") {
    return NextResponse.json({ error: { code: "forbidden", message: "Cross-company access denied" } }, { status: 403 });
  }

  const transcript = (call as any).transcripts?.[0]?.content as string | undefined;
  if (!transcript) {
    return NextResponse.json({ error: { code: "validation_failed", message: "No transcript on this call" } }, { status: 400 });
  }

  // Skip if already scored and not forcing
  if (!force) {
    const { data: existing } = await admin
      .from("scorecards")
      .select("id")
      .eq("call_id", call_id)
      .eq("is_current", true)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ scorecard_id: existing.id, status: "scored", skipped: true });
    }
  }

  // Mark scoring in progress
  await admin.from("calls").update({ scoring_status: "scoring" }).eq("id", call_id);

  // Mark previous current scorecard as not current (idempotent re-score)
  await admin.from("scorecards").update({ is_current: false }).eq("call_id", call_id).eq("is_current", true);

  // Compute current tier (before this call)
  const { data: priorScores } = await admin
    .from("scorecards")
    .select("average_score, created_at")
    .eq("rep_id", call.rep_id)
    .eq("is_current", true);
  const { data: settings } = await admin
    .from("company_settings")
    .select("rolling_window, min_calls_to_leave_tier1")
    .eq("company_id", call.company_id)
    .maybeSingle();

  const window = (settings?.rolling_window ?? "last_10") as RollingWindow;
  const tierBefore = computeRepTier({
    scores: (priorScores ?? []).map((s) => ({
      average_score: Number(s.average_score),
      created_at: s.created_at,
    })),
    window,
    minCallsToLeaveTier1: settings?.min_calls_to_leave_tier1 ?? 5,
  }).tier;

  // Score with Claude
  let result;
  try {
    result = await scoreCall({
      companyName: (call as any).companies?.name ?? "Unknown company",
      repName: (call as any).reps?.full_name ?? "Unknown rep",
      callType: call.call_type,
      leadSource: call.lead_source,
      callDatetime: call.call_datetime,
      sellerName: call.seller_name,
      transcript,
    });
  } catch (err: any) {
    await admin.from("calls").update({ scoring_status: "failed" }).eq("id", call_id);
    return NextResponse.json(
      { error: { code: "scoring_failed", message: err?.message ?? "Scoring failed" } },
      { status: 502 }
    );
  }

  const { parsed: out, raw, model, inputTokens, outputTokens, costUsd } = result;

  // Project tier after this score
  const projectedAvg =
    ((priorScores ?? []).reduce((a, s) => a + Number(s.average_score), 0) + out.average_score) /
    Math.max(1, (priorScores?.length ?? 0) + 1);
  const tierAfter = tierFromAverage(projectedAvg);

  // Persist scorecard + child rows in a single transaction (use admin to skip RLS, since we've authorized)
  const { data: sc, error: scErr } = await admin
    .from("scorecards")
    .insert({
      call_id,
      company_id: call.company_id,
      rep_id: call.rep_id,
      model,
      prompt_version: process.env.PROMPT_VERSION ?? "1.0.0",
      total_score: out.total_score,
      average_score: out.average_score,
      tier_before: tierBefore,
      tier_after_projection: tierAfter,
      biggest_mistake: out.biggest_mistake,
      best_moment: out.best_moment,
      missed_opportunity: out.missed_opportunity,
      should_have_said: out.should_have_said,
      suggested_followup_sms: out.suggested_followup_sms,
      suggested_followup_email: out.suggested_followup_email,
      coaching_notes_manager: out.coaching_notes_manager,
      coaching_notes_rep: out.coaching_notes_rep,
      deal_risk: out.deal_risk,
      conversion_probability: out.conversion_probability,
      recommended_next_action: out.recommended_next_action,
      raw_response: raw,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
      is_current: true,
    })
    .select("id")
    .single();

  if (scErr) {
    await admin.from("calls").update({ scoring_status: "failed" }).eq("id", call_id);
    return NextResponse.json({ error: { code: "internal", message: scErr.message } }, { status: 500 });
  }

  // Category scores
  await admin.from("category_scores").insert(
    SCORECARD_CATEGORIES.map((k) => ({
      scorecard_id: sc.id,
      company_id: call.company_id,
      category: k,
      score: out.category_scores[k].score,
      justification: out.category_scores[k].justification,
      supporting_quote: out.category_scores[k].supporting_quote ?? null,
    }))
  );

  // Discovery checks
  await admin.from("discovery_checks").insert(
    DISCOVERY_CHECKS.map((k) => ({
      scorecard_id: sc.id,
      company_id: call.company_id,
      check_key: k,
      was_uncovered: out.discovery_checks[k].was_uncovered,
      evidence_quote: out.discovery_checks[k].evidence_quote ?? null,
    }))
  );

  // Per-call coaching note
  await admin.from("coaching_notes").insert({
    company_id: call.company_id,
    rep_id: call.rep_id,
    scorecard_id: sc.id,
    kind: "per_call",
    body: `Biggest mistake: ${out.biggest_mistake}\n\nWhat to drill: ${out.coaching_notes_manager}`,
  });

  // Recompute rep tier + cached avg
  const allScores = [
    ...(priorScores ?? []).map((s) => ({ average_score: Number(s.average_score), created_at: s.created_at })),
    { average_score: out.average_score, created_at: new Date().toISOString() },
  ];
  const tierResult = computeRepTier({
    scores: allScores,
    window,
    minCallsToLeaveTier1: settings?.min_calls_to_leave_tier1 ?? 5,
  });

  // Get current rep tier to detect change
  const { data: repNow } = await admin.from("reps").select("current_tier").eq("id", call.rep_id).single();
  const oldTier = repNow?.current_tier ?? 1;

  await admin
    .from("reps")
    .update({
      current_tier: tierResult.tier,
      current_avg_score: tierResult.rolling_avg,
    })
    .eq("id", call.rep_id);

  if (oldTier !== tierResult.tier) {
    await admin.from("tier_history").insert({
      company_id: call.company_id,
      rep_id: call.rep_id,
      old_tier: oldTier,
      new_tier: tierResult.tier,
      avg_score_at_change: tierResult.rolling_avg,
      window_used: window,
      reason: `Rolling avg ${tierResult.rolling_avg ?? "n/a"} on ${tierResult.sample_size} calls`,
    });
  }

  // Mark call scored
  await admin.from("calls").update({ scoring_status: "scored" }).eq("id", call_id);

  // Audit
  await admin.from("audit_logs").insert({
    company_id: call.company_id,
    actor_user_id: profile.id,
    action: "scorecard.created",
    target_table: "scorecards",
    target_id: sc.id,
    metadata_json: { call_id, model, cost_usd: costUsd },
  });

  return NextResponse.json({
    scorecard_id: sc.id,
    status: "scored",
    tier_before: tierBefore,
    tier_after: tierAfter,
  });
}
