import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { ScorecardView } from "@/components/ScorecardView";
import { formatDateTime } from "@/lib/utils";
import type {
  RoadStep,
  StepScore,
  CriticalBreakpoint,
  ImprovementItem,
  MissedOpportunity,
} from "@/lib/types";

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");

  const supabase = await createSupabaseServerClient();

  const { data: call } = await supabase
    .from("calls")
    .select(`
      id, call_datetime, call_type, lead_source, seller_name, property_address,
      deal_outcome, scoring_status,
      reps:rep_id (id, full_name)
    `)
    .eq("id", id)
    .single();
  if (!call) notFound();

  const [{ data: transcript }, { data: scorecard }] = await Promise.all([
    supabase.from("transcripts").select("content, source").eq("call_id", id).maybeSingle(),
    supabase
      .from("scorecards")
      .select(`
        id, total_score, final_score, average_score,
        tier_before, tier_after_projection,
        critical_breakpoint_json, what_was_done_well,
        areas_for_improvement_json, missed_opportunities_json,
        improved_call_flow_summary,
        suggested_followup_sms, suggested_followup_email,
        coaching_notes_manager, coaching_notes_rep,
        deal_risk, conversion_probability, recommended_next_action,
        step_scores (step, score, justification, supporting_quote)
      `)
      .eq("call_id", id)
      .eq("is_current", true)
      .maybeSingle(),
  ]);

  return (
    <div className="space-y-6 p-8">
      <Link href="/calls" className="text-sm text-ink-500 hover:text-ink-900">← Back to calls</Link>

      <header className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold">{formatDateTime(call.call_datetime)}</span>
        <span className="text-ink-400">·</span>
        <span>{(call as any).reps?.full_name ?? "Unknown rep"}</span>
        <span className="text-ink-400">·</span>
        <span className="capitalize">{call.call_type.replace("_", " ")}</span>
        {call.lead_source && (<><span className="text-ink-400">·</span><span>{call.lead_source}</span></>)}
        {call.seller_name && (<><span className="text-ink-400">·</span><span>{call.seller_name}</span></>)}
      </header>

      {scorecard ? (
        <ScorecardView
          totalScore={Number(scorecard.total_score ?? 0)}
          finalScore={Number(scorecard.final_score ?? scorecard.average_score ?? 0)}
          tierBefore={scorecard.tier_before ?? 1}
          tierAfter={scorecard.tier_after_projection ?? scorecard.tier_before ?? 1}
          dealRisk={(scorecard.deal_risk ?? "medium") as "low" | "medium" | "high"}
          conversionProbability={scorecard.conversion_probability ?? 0}
          recommendedNextAction={scorecard.recommended_next_action ?? ""}
          steps={(scorecard.step_scores as any[]).map((s) => ({
            step: s.step as RoadStep,
            score: Number(s.score) as StepScore,
            justification: s.justification,
            supporting_quote: s.supporting_quote,
          }))}
          criticalBreakpoint={
            (scorecard.critical_breakpoint_json as CriticalBreakpoint | null) ?? null
          }
          whatWasDoneWell={scorecard.what_was_done_well ?? ""}
          areasForImprovement={
            (scorecard.areas_for_improvement_json as ImprovementItem[] | null) ?? []
          }
          missedOpportunities={
            (scorecard.missed_opportunities_json as MissedOpportunity[] | null) ?? []
          }
          improvedCallFlowSummary={scorecard.improved_call_flow_summary ?? ""}
          followupSms={scorecard.suggested_followup_sms ?? ""}
          followupEmail={scorecard.suggested_followup_email ?? ""}
          managerNotes={scorecard.coaching_notes_manager ?? ""}
          repNotes={scorecard.coaching_notes_rep ?? ""}
        />
      ) : (
        <ScoreStatus status={call.scoring_status} callId={call.id} />
      )}

      {transcript?.content && (
        <details className="rounded-lg border border-ink-200 bg-white p-5">
          <summary className="cursor-pointer text-sm font-semibold">Transcript</summary>
          <pre className="mt-3 whitespace-pre-wrap text-sm text-ink-800">{transcript.content}</pre>
        </details>
      )}
    </div>
  );
}

function ScoreStatus({ status, callId }: { status: string; callId: string }) {
  if (status === "scoring" || status === "pending") {
    return (
      <div className="rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-600">
        Scoring in progress… refresh in a moment.
      </div>
    );
  }
  if (status === "failed") {
    return (
      <form action="/api/calls/score" method="post" className="rounded-lg border border-rose-200 bg-rose-50 p-6">
        <input type="hidden" name="call_id" value={callId} />
        <div className="text-sm text-rose-800">Scoring failed.</div>
        <button className="mt-3 rounded-md bg-rose-700 px-3 py-1.5 text-sm text-white hover:bg-rose-800">
          Retry
        </button>
      </form>
    );
  }
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-600">
      No scorecard yet for this call.
    </div>
  );
}
