import { describe, it, expect } from "vitest";
import { projectWeeklyIncentives, type RepWeekStats, DEFAULT_RULES } from "./incentive";

describe("projectWeeklyIncentives", () => {
  const baseRep: RepWeekStats = {
    rep_id: "r1",
    tier: 3,
    calls_count: 35,
    avg_score: 7,
    contracts: 1,
    discovery_avg: 7,
    closing_avg: 7,
    improvement_delta: 0,
    coaching_acked_pct: 0,
  };

  it("pays tier-3 weekly when calls floor met", () => {
    const out = projectWeeklyIncentives([baseRep]);
    expect(out[0].weekly_bonus_amount).toBe(200);
  });

  it("does not pay when calls floor not met", () => {
    const out = projectWeeklyIncentives([{ ...baseRep, calls_count: 10 }]);
    expect(out[0].weekly_bonus_amount).toBe(0);
  });

  it("awards highest_avg to the top rep only", () => {
    const reps: RepWeekStats[] = [
      { ...baseRep, rep_id: "a", avg_score: 9 },
      { ...baseRep, rep_id: "b", avg_score: 7 },
    ];
    const out = projectWeeklyIncentives(reps);
    const a = out.find((o) => o.rep_id === "a")!;
    const b = out.find((o) => o.rep_id === "b")!;
    expect(a.awards.find((x) => x.key === "highest_avg")?.amount).toBe(DEFAULT_RULES.awards.highest_avg);
    expect(b.awards.find((x) => x.key === "highest_avg")).toBeUndefined();
  });

  it("includes coaching completion when fully acked", () => {
    const out = projectWeeklyIncentives([{ ...baseRep, coaching_acked_pct: 1 }]);
    expect(out[0].awards.some((a) => a.key === "coaching_completion")).toBe(true);
  });
});
