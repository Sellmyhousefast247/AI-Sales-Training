import { describe, it, expect } from "vitest";
import { scorecardOutputSchema } from "./schema";
import { ROAD_TO_DEAL_STEPS, type RoadStep } from "@/lib/types";

function fullStepScores(value: 0 | 5 | 10) {
  return Object.fromEntries(
    ROAD_TO_DEAL_STEPS.map((k) => [
      k,
      { score: value, justification: `step ${k}`, supporting_quote: "" },
    ])
  ) as Record<RoadStep, { score: 0 | 5 | 10; justification: string; supporting_quote: string }>;
}

const validBase = {
  step_scores: fullStepScores(10),
  total_score: 100,
  final_score: 10,
  critical_breakpoint: {
    quote: "x",
    step_failed: "rapport" as RoadStep,
    why_it_caused_loss: "y",
    what_should_have_happened: "z",
  },
  what_was_done_well: "good",
  areas_for_improvement: [
    {
      rep_said: "rep quote",
      issue: "issue text",
      better_approach: "do this",
      corrected_script: "say this",
    },
  ],
  missed_opportunities: [],
  improved_call_flow_summary: "flow",
  suggested_followup_sms: "sms",
  suggested_followup_email: "email",
  coaching_notes_manager: "mgr",
  coaching_notes_rep: "rep",
  deal_risk: "low" as const,
  conversion_probability: 80,
  recommended_next_action: "do x",
};

describe("scorecardOutputSchema", () => {
  it("accepts a valid all-10 scorecard", () => {
    expect(() => scorecardOutputSchema.parse(validBase)).not.toThrow();
  });

  it("accepts any integer step score from 0-10", () => {
    const mid = {
      ...validBase,
      step_scores: {
        ...validBase.step_scores,
        rapport: { score: 7, justification: "x", supporting_quote: "" },
      },
    };
    expect(() => scorecardOutputSchema.parse(mid)).not.toThrow();
  });

  it("rejects step scores outside 0-10", () => {
    const bad = {
      ...validBase,
      step_scores: {
        ...validBase.step_scores,
        rapport: { score: 11, justification: "x", supporting_quote: "" },
      },
    };
    expect(() => scorecardOutputSchema.parse(bad)).toThrow();
  });

  it("requires at least one improvement item", () => {
    const bad = { ...validBase, areas_for_improvement: [] };
    expect(() => scorecardOutputSchema.parse(bad)).toThrow();
  });

  it("rejects unknown step keys in critical breakpoint", () => {
    const bad = {
      ...validBase,
      critical_breakpoint: { ...validBase.critical_breakpoint, step_failed: "not_a_step" as any },
    };
    expect(() => scorecardOutputSchema.parse(bad)).toThrow();
  });

  it("accepts a partial-score mix", () => {
    const mixed = {
      ...validBase,
      step_scores: {
        ...fullStepScores(0),
        rapport: { score: 10 as const, justification: "x", supporting_quote: "" },
        motivation: { score: 5 as const, justification: "y", supporting_quote: "" },
      },
      total_score: 15,
      final_score: 1.5,
    };
    expect(() => scorecardOutputSchema.parse(mixed)).not.toThrow();
  });
});
