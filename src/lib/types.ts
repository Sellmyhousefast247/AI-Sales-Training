// Domain types — single source of truth for shapes used across server + client.

export type Role = "super_admin" | "company_admin" | "manager" | "rep";

export type CallType =
  | "inbound"
  | "outbound"
  | "follow_up"
  | "offer"
  | "negotiation"
  | "closing";

export type DealOutcome =
  | "contract"
  | "appointment"
  | "offer_made"
  | "follow_up"
  | "dead"
  | "unknown";

export type RollingWindow = "last_10" | "last_30d" | "all_time";

// ─────────────────────────────────────────────────────────────────────
// Road to a Deal — the canonical 10-step framework from the
// "2026 ACQ Closer Manual V3.8". Every call is scored against these
// steps. Each step is worth 10 points: 0 not done, 5 weak, 10 correct.
// ─────────────────────────────────────────────────────────────────────
export const ROAD_TO_DEAL_STEPS = [
  "rapport",
  "motivation",
  "asking_price",
  "trial_close_1",
  "first_hold",
  "anchor",
  "negotiation",
  "trial_close_2",
  "second_hold",
  "approval_close",
] as const;
export type RoadStep = (typeof ROAD_TO_DEAL_STEPS)[number];

export const STEP_LABELS: Record<RoadStep, string> = {
  rapport: "Rapport",
  motivation: "Motivation (Why / Condition / Timeline)",
  asking_price: "Get Asking Price",
  trial_close_1: "Trial Close 1",
  first_hold: "First Hold",
  anchor: "Anchor",
  negotiation: "Negotiation",
  trial_close_2: "Trial Close 2",
  second_hold: "Second Hold",
  approval_close: "Approval / Close",
};

export const STEP_NUMBER: Record<RoadStep, number> = {
  rapport: 1,
  motivation: 2,
  asking_price: 3,
  trial_close_1: 4,
  first_hold: 5,
  anchor: 6,
  negotiation: 7,
  trial_close_2: 8,
  second_hold: 9,
  approval_close: 10,
};

export type StepScore = 0 | 5 | 10;

export const STEP_SCORE_LABEL: Record<StepScore, string> = {
  0: "Not done",
  5: "Attempted (weak)",
  10: "Executed correctly",
};

export type Tier = 1 | 2 | 3 | 4 | 5;

export const TIER_META: Record<Tier, { label: string; status: string; min: number; max: number }> = {
  1: { label: "Trainee",    status: "Needs heavy coaching",         min: 0.0, max: 4.99 },
  2: { label: "Developing", status: "Improving but inconsistent",   min: 5.0, max: 6.49 },
  3: { label: "Competent",  status: "Reliable rep",                 min: 6.5, max: 7.99 },
  4: { label: "Advanced",   status: "High performer",               min: 8.0, max: 8.99 },
  5: { label: "Elite",      status: "Top closer / leadership",      min: 9.0, max: 10.0 },
};

// ─────────────────────────────────────────────────────────────────────
// Structured coaching output, V3.8 spec
// ─────────────────────────────────────────────────────────────────────

export interface ImprovementItem {
  rep_said: string;
  issue: string;
  better_approach: string;
  corrected_script: string;
  step?: RoadStep;
}

export interface MissedOpportunity {
  rep_said?: string;
  what_was_missed: string;
  fix: string;
}

export interface CriticalBreakpoint {
  quote: string;
  step_failed: RoadStep;
  why_it_caused_loss: string;
  what_should_have_happened: string;
}

export interface ScorecardOutput {
  step_scores: Record<
    RoadStep,
    { score: StepScore; justification: string; supporting_quote?: string }
  >;
  total_score: number; // 0–100, sum of step scores
  final_score: number; // 0.0–10.0, total / 10

  critical_breakpoint: CriticalBreakpoint;
  what_was_done_well: string;
  areas_for_improvement: ImprovementItem[];
  missed_opportunities: MissedOpportunity[];
  improved_call_flow_summary: string;

  // Practical fields used by dashboard/leaderboard/follow-up
  suggested_followup_sms: string;
  suggested_followup_email: string;
  coaching_notes_manager: string;
  coaching_notes_rep: string;
  deal_risk: "low" | "medium" | "high";
  conversion_probability: number; // 0–100
  recommended_next_action: string;
}
