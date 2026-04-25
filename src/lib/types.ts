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

export const SCORECARD_CATEGORIES = [
  "opening_tone",
  "rapport_building",
  "discovery",
  "question_quality",
  "call_control",
  "objection_handling",
  "value_positioning",
  "offer_delivery",
  "closing_ability",
  "conversion_likelihood",
] as const;
export type ScoreCategory = (typeof SCORECARD_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ScoreCategory, string> = {
  opening_tone: "Opening & Tone",
  rapport_building: "Rapport Building",
  discovery: "Discovery",
  question_quality: "Question Quality",
  call_control: "Call Control",
  objection_handling: "Objection Handling",
  value_positioning: "Value Positioning",
  offer_delivery: "Offer Delivery",
  closing_ability: "Closing Ability",
  conversion_likelihood: "Conversion Likelihood",
};

export const DISCOVERY_CHECKS = [
  "motivation",
  "timeline",
  "condition",
  "price_expectation",
  "equity_mortgage",
  "decision_makers",
  "urgency",
  "pain_points",
  "preferred_outcome",
] as const;
export type DiscoveryCheckKey = (typeof DISCOVERY_CHECKS)[number];

export const DISCOVERY_LABELS: Record<DiscoveryCheckKey, string> = {
  motivation: "Motivation",
  timeline: "Timeline",
  condition: "Property Condition",
  price_expectation: "Price Expectation",
  equity_mortgage: "Equity / Mortgage",
  decision_makers: "Decision Makers",
  urgency: "Urgency",
  pain_points: "Pain Points",
  preferred_outcome: "Preferred Outcome",
};

export type Tier = 1 | 2 | 3 | 4 | 5;

export const TIER_META: Record<Tier, { label: string; status: string; min: number; max: number }> = {
  1: { label: "Trainee",    status: "Needs heavy coaching",         min: 0.0, max: 4.99 },
  2: { label: "Developing", status: "Improving but inconsistent",   min: 5.0, max: 6.49 },
  3: { label: "Competent",  status: "Reliable rep",                 min: 6.5, max: 7.99 },
  4: { label: "Advanced",   status: "High performer",               min: 8.0, max: 8.99 },
  5: { label: "Elite",      status: "Top closer / leadership",      min: 9.0, max: 10.0 },
};

export interface ScorecardOutput {
  category_scores: Record<
    ScoreCategory,
    { score: number; justification: string; supporting_quote?: string }
  >;
  discovery_checks: Record<
    DiscoveryCheckKey,
    { was_uncovered: boolean; evidence_quote?: string }
  >;
  total_score: number;
  average_score: number;
  biggest_mistake: string;
  best_moment: string;
  missed_opportunity: string;
  should_have_said: string;
  suggested_followup_sms: string;
  suggested_followup_email: string;
  coaching_notes_manager: string;
  coaching_notes_rep: string;
  deal_risk: "low" | "medium" | "high";
  conversion_probability: number;
  recommended_next_action: string;
}
