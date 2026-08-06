import { z } from "zod";
import { ROAD_TO_DEAL_STEPS } from "@/lib/types";

const stepKey = z.enum(ROAD_TO_DEAL_STEPS);

const stepScore = z.object({
  score: z.number().int().min(0).max(10),
  justification: z.string().min(1),
  supporting_quote: z.string().optional().default(""),
});

const improvementItem = z.object({
  rep_said: z.string(),
  issue: z.string(),
  better_approach: z.string(),
  corrected_script: z.string(),
  step: stepKey.optional(),
});

const missedOpportunity = z.object({
  rep_said: z.string().optional().default(""),
  what_was_missed: z.string(),
  fix: z.string(),
});

const criticalBreakpoint = z.object({
  quote: z.string(),
  step_failed: stepKey,
  why_it_caused_loss: z.string(),
  what_should_have_happened: z.string(),
});

export const scorecardOutputSchema = z.object({
  step_scores: z.object(
    Object.fromEntries(ROAD_TO_DEAL_STEPS.map((k) => [k, stepScore])) as Record<
      (typeof ROAD_TO_DEAL_STEPS)[number],
      typeof stepScore
    >
  ),
  total_score: z.number().int().min(0).max(100),
  final_score: z.number().min(0).max(10),
  critical_breakpoint: criticalBreakpoint,
  what_was_done_well: z.string(),
  areas_for_improvement: z.array(improvementItem).min(1),
  missed_opportunities: z.array(missedOpportunity).default([]),
  improved_call_flow_summary: z.string(),
  suggested_followup_sms: z.string(),
  suggested_followup_email: z.string(),
  coaching_notes_manager: z.string(),
  coaching_notes_rep: z.string(),
  deal_risk: z.enum(["low", "medium", "high"]),
  conversion_probability: z.number().int().min(0).max(100),
  recommended_next_action: z.string(),
});

export type ParsedScorecard = z.infer<typeof scorecardOutputSchema>;
