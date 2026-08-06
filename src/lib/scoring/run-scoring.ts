import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreCall } from "@/lib/ai/score-call";
import { computeRepTier, tierFromAverage } from "@/lib/tier";
import { ROAD_TO_DEAL_STEPS, type RollingWindow } from "@/lib/types";

export interface RunScoringOptions {
  force?: boolean;
  /** User who triggered scoring; null for automated (webhook/cron) runs. */
  actorUserId?: string | null;
}

export type RunScoringResult =
  | { ok: true; scorecard_id: string; status: "scored"; skipped?: boolean; final_score?: number; total_score?: number; tier_before?: number; tier_after?: number }
  | { ok: false; code: "not_found" | "no_transcript" | "scoring_failed" | "internal"; message: string };

/**
 * Core scoring pipeline, extracted from the /api/calls/score route so it can
 * run from webhook ingestion and background jobs without an HTTP session.
 *
 * The caller is responsible for authorization — `admin` bypasses RLS.
 */
export async function runScoringForCall(
  admin: SupabaseClient,
  callId: string,
  opts: RunScoringOptions = {}
): Promise<RunScoringResult> {
  const { force = false, actorUserId = null } = opts;

  const { data: call, error: callErr } = await admin
    .from("calls")
    .select(`
      id, company_id, rep_id, call_datetime, call_type, lead_source, seller_name,
      reps:rep_id (full_name),
      companies:company_id (name),
      transcripts:transcripts!transcripts_call_id_fkey (content)
    `)
    .eq("id", callId)
    .single();

  if (callErr || !call) {
    return { ok: false, code: "not_found", message: "Call not found" };
  }

  // transcripts.call_id is UNIQUE, so PostgREST may return the embed as a
  // single object (one-to-one) or an array depending on schema detection.
  const embedded = (call as any).transcripts;
  const transcript = (Array.isArray(embedded) ? embedded[0]?.content : embedded?.content) as
    | string
    | undefined;
  if (!transcript) {
    return { ok: false, code: "no_transcript", message: "No transcript on this call" };
  }

  if (!force) {
    const { data: existing } = await admin
      .from("scorecards")
      .select("id")
      .eq("call_id", callId)
      .eq("is_current", true)
      .maybeSingle();
    if (existing) {
      return { ok: true, scorecard_id: existing.id, status: "scored", skipped: true };
    }
  }

  await admin.from("calls").update({ scoring_status: "scoring" }).eq("id", callId);
  await admin.from("scorecards").update({ is_current: false }).eq("call_id", callId).eq("is_current", true);

  const { data: settings } = await admin
    .from("company_settings")
    .select("rolling_window, min_calls_to_leave_tier1, script_content")
    .eq("company_id", call.company_id)
    .maybeSingle();

  const window = (settings?.rolling_window ?? "last_10") as RollingWindow;

  const { data: priorScores } = await admin
    .from("scorecards")
    .select("final_score, average_score, created_at")
    .eq("rep_id", call.rep_id)
    .eq("is_current", true);

  const tierBefore = computeRepTier({
    scores: (priorScores ?? []).map((s: any) => ({
      average_score: Number(s.final_score ?? s.average_score),
      created_at: s.created_at,
    })),
    window,
    minCallsToLeaveTier1: settings?.min_calls_to_leave_tier1 ?? 5,
  }).tier;

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
      scriptContent: settings?.script_content ?? null,
    });
  } catch (err: any) {
    await admin.from("calls").update({ scoring_status: "failed" }).eq("id", callId);
    return { ok: false, code: "scoring_failed", message: err?.message ?? "Scoring failed" };
  }

  const { parsed: out, raw, model, inputTokens, outputTokens, costUsd } = result;

  const projectedAvg =
    ((priorScores ?? []).reduce((a: number, s: any) => a + Number(s.final_score ?? s.average_score), 0) + out.final_score) /
    Math.max(1, (priorScores?.length ?? 0) + 1);
  const tierAfter = tierFromAverage(projectedAvg);

  const firstImprovement = out.areas_for_improvement[0];
  const denormBiggestMistake = firstImprovement?.issue ?? out.critical_breakpoint.why_it_caused_loss;
  const denormBestMoment = out.what_was_done_well;
  const denormMissed = out.missed_opportunities[0]?.what_was_missed ?? "";
  const denormShouldHaveSaid = firstImprovement?.corrected_script ?? out.critical_breakpoint.what_should_have_happened;

  const { data: sc, error: scErr } = await admin
    .from("scorecards")
    .insert({
      call_id: callId,
      company_id: call.company_id,
      rep_id: call.rep_id,
      model,
      prompt_version: process.env.PROMPT_VERSION ?? "1.0.0",
      total_score: out.total_score,
      average_score: out.final_score, // back-compat
      final_score: out.final_score,
      tier_before: tierBefore,
      tier_after_projection: tierAfter,
      biggest_mistake: denormBiggestMistake,
      best_moment: denormBestMoment,
      missed_opportunity: denormMissed,
      should_have_said: denormShouldHaveSaid,
      critical_breakpoint_json: out.critical_breakpoint,
      what_was_done_well: out.what_was_done_well,
      areas_for_improvement_json: out.areas_for_improvement,
      missed_opportunities_json: out.missed_opportunities,
      improved_call_flow_summary: out.improved_call_flow_summary,
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
    await admin.from("calls").update({ scoring_status: "failed" }).eq("id", callId);
    return { ok: false, code: "internal", message: scErr.message };
  }

  await admin.from("step_scores").insert(
    ROAD_TO_DEAL_STEPS.map((k) => ({
      scorecard_id: sc.id,
      company_id: call.company_id,
      step: k,
      score: out.step_scores[k].score,
      justification: out.step_scores[k].justification,
      supporting_quote: out.step_scores[k].supporting_quote ?? null,
    }))
  );

  await admin.from("coaching_notes").insert({
    company_id: call.company_id,
    rep_id: call.rep_id,
    scorecard_id: sc.id,
    kind: "per_call",
    body: `Critical breakpoint at step ${out.critical_breakpoint.step_failed}: ${out.critical_breakpoint.why_it_caused_loss}\n\nWhat to drill: ${out.coaching_notes_manager}`,
  });

  const allScores = [
    ...(priorScores ?? []).map((s: any) => ({
      average_score: Number(s.final_score ?? s.average_score),
      created_at: s.created_at,
    })),
    { average_score: out.final_score, created_at: new Date().toISOString() },
  ];
  const tierResult = computeRepTier({
    scores: allScores,
    window,
    minCallsToLeaveTier1: settings?.min_calls_to_leave_tier1 ?? 5,
  });

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

  await admin.from("calls").update({ scoring_status: "scored" }).eq("id", callId);

  await admin.from("audit_logs").insert({
    company_id: call.company_id,
    actor_user_id: actorUserId,
    action: "scorecard.created",
    target_table: "scorecards",
    target_id: sc.id,
    metadata_json: { call_id: callId, model, cost_usd: costUsd, automated: !actorUserId },
  });

  return {
    ok: true,
    scorecard_id: sc.id,
    status: "scored",
    final_score: out.final_score,
    total_score: out.total_score,
    tier_before: tierBefore,
    tier_after: tierAfter,
  };
}
