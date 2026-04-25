import { z } from "zod";
import { SCORECARD_CATEGORIES, DISCOVERY_CHECKS } from "@/lib/types";

const categoryScore = z.object({
  score: z.number().min(0).max(10),
  justification: z.string().min(1),
  supporting_quote: z.string().optional().default(""),
});

const discoveryCheck = z.object({
  was_uncovered: z.boolean(),
  evidence_quote: z.string().optional().default(""),
});

export const scorecardOutputSchema = z.object({
  category_scores: z.object(
    Object.fromEntries(SCORECARD_CATEGORIES.map((k) => [k, categoryScore])) as Record<
      (typeof SCORECARD_CATEGORIES)[number],
      typeof categoryScore
    >
  ),
  discovery_checks: z.object(
    Object.fromEntries(DISCOVERY_CHECKS.map((k) => [k, discoveryCheck])) as Record<
      (typeof DISCOVERY_CHECKS)[number],
      typeof discoveryCheck
    >
  ),
  total_score: z.number().min(0).max(100),
  average_score: z.number().min(0).max(10),
  biggest_mistake: z.string(),
  best_moment: z.string(),
  missed_opportunity: z.string(),
  should_have_said: z.string(),
  suggested_followup_sms: z.string(),
  suggested_followup_email: z.string(),
  coaching_notes_manager: z.string(),
  coaching_notes_rep: z.string(),
  deal_risk: z.enum(["low", "medium", "high"]),
  conversion_probability: z.number().int().min(0).max(100),
  recommended_next_action: z.string(),
});

export type ParsedScorecard = z.infer<typeof scorecardOutputSchema>;
