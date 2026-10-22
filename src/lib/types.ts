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
// Road to a Deal — the canonical 10-step framework, aligned with the
// "Acquisitions Call Script (10/21/26)". Every call is scored against
// these steps. Each step is worth 10 points: 0 not done, 5 weak, 10 correct.
// ─────────────────────────────────────────────────────────────────────
export const ROAD_TO_DEAL_STEPS = [
  "intro",
  "reveal",
  "obstacles",
  "future_pace",
  "assessment",
  "positioning",
  "hold_process",
  "offer",
  "close_negotiation",
  "contract_wrapup",
] as const;
export type RoadStep = (typeof ROAD_TO_DEAL_STEPS)[number];

export const STEP_LABELS: Record<RoadStep, string> = {
  intro: "Introduction & Expectations",
  reveal: "Reveal (Motivation & Pain)",
  obstacles: "Obstacles & Timeline",
  future_pace: "Future Pace",
  assessment: "Assessment (Property Walkthrough)",
  positioning: "Secure Positioning (Needs & Concerns)",
  hold_process: "Hold & Process Walkthrough",
  offer: "Offer Presentation",
  close_negotiation: "Close & Negotiation",
  contract_wrapup: "Contract & Wrap-up",
};

export const STEP_NUMBER: Record<RoadStep, number> = {
  intro: 1,
  reveal: 2,
  obstacles: 3,
  future_pace: 4,
  assessment: 5,
  positioning: 6,
  hold_process: 7,
  offer: 8,
  close_negotiation: 9,
  contract_wrapup: 10,
};

/** One-paragraph definition of what earns credit on each step (mirrors the scoring prompt). */
export const STEP_DEFINITIONS: Record<RoadStep, string> = {
  intro: "Greets by name, states who they are and why they're calling, sets expectations for the call (basic first call, simple agreement at the end, 'speed is important, right?'), confirms the seller can move forward, and gives the notepad info: name, company, website, phone (repeated back), file number JC-{last 4}.",
  reveal: "Uncovers the WHY. Asks what made them ready to move now, probes occupancy/situation, and keeps probing (goal 7+ questions) until the seller FEELS the pain. Asks 'why now?' and how long it's been going on. The longest section of the call.",
  obstacles: "Finds the ideal timeline ('ideally, when would you like to…'), what they've tried so far, what's prevented them, and how they'd choose between companies / why not list with a realtor.",
  future_pace: "Gets the seller talking about life AFTER the sale: no longer dealing with {problem}, finally {solution} — how different is that, what are they looking forward to, how will it feel.",
  assessment: "Walks the exterior (neighborhood, neighbors, windows/doors, road, power lines, structure, roof, HVAC, back structures) then the interior (layout, updates since built, flooring, walls, counters, appliances, bathrooms, plumbing type, electrical) and asks the $50k Home Depot question.",
  positioning: "Before price: anything else to figure out, deadline, other decision-makers/realtors, the NEEDS number in their pocket, mortgage balance, the 40-50% investor conditioning ('by no means our offer'), and the key question 'if we get you close to that… would you have any concerns?' — stays on it until no concerns, then 'what do you want the next steps to be?'",
  hold_process: "Sets up the underwriting hold (approval or denial with a reason), returns with the follow-up questions (HVAC/roof age, schools, grocery, foundation, septic/sewer, water, internet), explains the full process (file #, 3-page agreement, photos in 72h, contractors/partner market, hands-off walkthroughs, sit back and get paid), asks 'any questions or concerns about the process?', then takes the second hold.",
  offer: "Presents the approval as a qualification (CONGRATS / 'came in around where I thought'), ties the net to the dream outcome, gives ONE specific odd number, and if it's low asks 'what were you hoping I was at least going to say?' / 'better position than you are now?'",
  close_negotiation: "Finds how far apart we are without negotiating live, brings it back to the team, moves in small controlled steps, pivots to the Equity Protection Program when needed (explains the tradeoff, 'does that make sense?', 'comfortable working with?'), and isolates the objection: 'if you had that amount in your pocket… any other reason you wouldn't move forward?'",
  contract_wrapup: "On acceptance: congratulates with excitement, explains as-is/no commissions/no fees/access, virtual withdraw account + file number read-back, specific odd number, sends the contract and STAYS ON until signed (name/price/address check, initials, pages 2-3, earnest money / due diligence / MLS / 'why not list myself' objections), then wraps strong: access schedule, TC + Curtis handoff, 210 number, 'Have a blessed day!'",
};

/**
 * Legacy step keys from the pre-10/21/26 "Road to a Deal V3.8" rubric.
 * Old scorecards still carry these; they are displayed by their original
 * labels and mapped by ORDINAL (1→1 … 10→10) only for compact chip views.
 */
export const LEGACY_STEPS = [
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
export type LegacyStep = (typeof LEGACY_STEPS)[number];

export const LEGACY_STEP_LABELS: Record<LegacyStep, string> = {
  rapport: "Rapport (v1)",
  motivation: "Motivation (v1)",
  asking_price: "Get Asking Price (v1)",
  trial_close_1: "Trial Close 1 (v1)",
  first_hold: "First Hold (v1)",
  anchor: "Anchor (v1)",
  negotiation: "Negotiation (v1)",
  trial_close_2: "Trial Close 2 (v1)",
  second_hold: "Second Hold (v1)",
  approval_close: "Approval / Close (v1)",
};

export function isLegacyStep(k: string): k is LegacyStep {
  return (LEGACY_STEPS as readonly string[]).includes(k);
}
export function isRoadStep(k: string): k is RoadStep {
  return (ROAD_TO_DEAL_STEPS as readonly string[]).includes(k);
}
/** Label for any step key, current or legacy (falls back to the raw key). */
export function stepLabel(k: string): string {
  if (isRoadStep(k)) return STEP_LABELS[k];
  if (isLegacyStep(k)) return LEGACY_STEP_LABELS[k];
  return k;
}
/** Step number (1-10) for any step key, current or legacy. */
export function stepNumber(k: string): number | null {
  if (isRoadStep(k)) return STEP_NUMBER[k];
  if (isLegacyStep(k)) return LEGACY_STEPS.indexOf(k) + 1;
  return null;
}

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
