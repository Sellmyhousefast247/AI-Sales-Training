import { describe, expect, it } from "vitest";
import { computeListStats, type AnalysisListItem } from "./stats";

function row(overrides: Partial<AnalysisListItem> = {}): AnalysisListItem {
  return {
    arv: 300_000,
    as_is_value: 220_000,
    repair_estimate: 40_000,
    wholesale_mao: 150_000,
    novation_mao: 158_000,
    comps_used: 5,
    confidence_score: "Medium",
    ...overrides,
  };
}

describe("computeListStats", () => {
  it("returns zeros for an empty list", () => {
    const s = computeListStats([]);
    expect(s).toEqual({
      count: 0,
      avg_arv: 0,
      avg_as_is: 0,
      avg_repairs: 0,
      total_wholesale_mao: 0,
      total_novation_mao: 0,
      median_comps_used: 0,
      high_confidence_pct: 0,
      low_confidence_pct: 0,
    });
  });

  it("averages and totals across rows", () => {
    const s = computeListStats([
      row({ arv: 200_000, as_is_value: 150_000, repair_estimate: 30_000, wholesale_mao: 100_000, novation_mao: 110_000 }),
      row({ arv: 400_000, as_is_value: 300_000, repair_estimate: 50_000, wholesale_mao: 200_000, novation_mao: 220_000 }),
    ]);
    expect(s.count).toBe(2);
    expect(s.avg_arv).toBe(300_000);
    expect(s.avg_as_is).toBe(225_000);
    expect(s.avg_repairs).toBe(40_000);
    expect(s.total_wholesale_mao).toBe(300_000);
    expect(s.total_novation_mao).toBe(330_000);
  });

  it("computes the odd-length median exactly", () => {
    const s = computeListStats([
      row({ comps_used: 3 }),
      row({ comps_used: 7 }),
      row({ comps_used: 5 }),
    ]);
    expect(s.median_comps_used).toBe(5);
  });

  it("averages the two middle values for even-length median", () => {
    const s = computeListStats([
      row({ comps_used: 2 }),
      row({ comps_used: 4 }),
      row({ comps_used: 6 }),
      row({ comps_used: 8 }),
    ]);
    expect(s.median_comps_used).toBe(5);
  });

  it("computes confidence percentages", () => {
    const s = computeListStats([
      row({ confidence_score: "High" }),
      row({ confidence_score: "High" }),
      row({ confidence_score: "Medium" }),
      row({ confidence_score: "Low" }),
    ]);
    expect(s.high_confidence_pct).toBe(0.5);
    expect(s.low_confidence_pct).toBe(0.25);
  });

  it("treats non-finite numeric fields as 0", () => {
    const s = computeListStats([
      row({ arv: NaN as unknown as number }),
      row({ arv: 100_000 }),
    ]);
    expect(s.avg_arv).toBe(50_000);
  });
});
