import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { buildCallReportPdf } from "@/lib/report/call-report-pdf";
import type { RoadStep } from "@/lib/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * GET /api/calls/[id]/report — downloadable PDF of the call's current
 * scorecard (Road to a Deal, breakpoint, improvements, coaching notes) so a
 * manager can hand the review to the rep. Logged-in users only; RLS scopes
 * the data to the caller's company.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: { message: "Not signed in" } }, { status: 401 });
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: call }, { data: company }, { data: scorecard }] = await Promise.all([
    supabase
      .from("calls")
      .select(`
        id, call_datetime, call_type, lead_source, seller_name, recording_duration_sec,
        reps:rep_id (full_name)
      `)
      .eq("id", id)
      .single(),
    supabase.from("companies").select("name").eq("id", profile.company_id).single(),
    supabase
      .from("scorecards")
      .select(`
        total_score, final_score, average_score,
        critical_breakpoint_json, what_was_done_well,
        areas_for_improvement_json, missed_opportunities_json,
        coaching_notes_manager, coaching_notes_rep,
        deal_risk, conversion_probability, recommended_next_action,
        step_scores (step, score, justification, supporting_quote)
      `)
      .eq("call_id", id)
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!call) return NextResponse.json({ error: { message: "Call not found" } }, { status: 404 });
  if (!scorecard) {
    return NextResponse.json(
      { error: { message: "This call has no scorecard yet - score it first, then download the report." } },
      { status: 400 }
    );
  }

  const pdf = await buildCallReportPdf({
    companyName: company?.name ?? "Sell My House Fast",
    sellerName: call.seller_name ?? "Unknown seller",
    repName: (call as any).reps?.full_name ?? "Unknown rep",
    callDatetime: call.call_datetime,
    callType: call.call_type ?? "call",
    leadSource: call.lead_source ?? null,
    durationSec: call.recording_duration_sec ?? null,
    finalScore: Number(scorecard.final_score ?? scorecard.average_score ?? 0),
    totalScore: Number(scorecard.total_score ?? 0),
    steps: ((scorecard as any).step_scores ?? []).map((s: any) => ({
      step: s.step as RoadStep,
      score: Number(s.score ?? 0),
      justification: s.justification ?? "",
      supporting_quote: s.supporting_quote || null,
    })),
    criticalBreakpoint: (scorecard.critical_breakpoint_json as any) ?? null,
    whatWasDoneWell: scorecard.what_was_done_well ?? null,
    areasForImprovement: ((scorecard.areas_for_improvement_json as any) ?? []) as any[],
    missedOpportunities: ((scorecard.missed_opportunities_json as any) ?? []) as any[],
    coachingNotesRep: scorecard.coaching_notes_rep ?? null,
    coachingNotesManager: scorecard.coaching_notes_manager ?? null,
    dealRisk: scorecard.deal_risk ?? null,
    conversionProbability: scorecard.conversion_probability ?? null,
    recommendedNextAction: scorecard.recommended_next_action ?? null,
  });

  const safeName = (call.seller_name ?? "call")
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  const dateTag = String(call.call_datetime ?? "").slice(0, 10);
  // Uint8Array -> fresh ArrayBuffer keeps the BodyInit types happy.
  const body = new Uint8Array(pdf).buffer as ArrayBuffer;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="call-review-${safeName}-${dateTag}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
