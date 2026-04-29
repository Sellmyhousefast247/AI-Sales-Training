import { describe, expect, it } from "vitest";
import {
  computeDeltas,
  deltaIsImprovement,
  type AnalysisNumbers,
} from "./deltas";

const baseline: AnalysisNumbers = {
  arv: 300_000,
  as_is_value: 220_000,
  repair_estimate: 40_000,
  buying_pct: 0.7,
  wholesale_mao: 150_000,
  novation_mao: 158_000,
  market_adjusted_mao: 160_000,
};

describe("computeDeltas", () => {
  it("returns empty when prev is null", () => {
    expect(computeDeltas(baseline, null)).toEqual({});
    expect(computeDeltas(baseline, undefined)).toEqual({});
  });

  it("returns empty when nothing changed", () => {
    expect(computeDeltas(baseline, baseline)).toEqual({});
  });

  it("computes diff + pct for changed keys only", () => {
    const out = computeDeltas(
      { ...baseline, arv: 320_000, repair_estimate: 50_000 },
      baseline
    );
    expect(out.arv).toEqual({
      diff: 20_000,
      pct: 20_000 / 300_000,
    });
    expect(out.repair_estimate).toEqual({
      diff: 10_000,
      pct: 10_000 / 40_000,
    });
    // Unchanged keys stay out.
    expect(out.as_is_value).toBeUndefined();
    expect(out.wholesale_mao).toBeUndefined();
  });

  it("handles a prev of zero without dividing by zero", () => {
    const prev = { ...baseline, novation_mao: 0 };
    const cur = { ...baseline, novation_mao: 50_000 };
    const out = computeDeltas(cur, prev);
    expect(out.novation_mao).toEqual({ diff: 50_000, pct: 0 });
  });

  it("handles negative deltas", () => {
    const out = computeDeltas({ ...baseline, arv: 290_000 }, baseline);
    expect(out.arv).toEqual({
      diff: -10_000,
      pct: -10_000 / 300_000,
    });
  });

  it("ignores non-finite values silently", () => {
    const out = computeDeltas(
      { ...baseline, arv: NaN as unknown as number },
      baseline
    );
    expect(out.arv).toBeUndefined();
  });
});

describe("deltaIsImprovement", () => {
  it("treats higher repair_estimate as worse", () => {
    expect(deltaIsImprovement("repair_estimate", 5_000)).toBe(false);
    expect(deltaIsImprovement("repair_estimate", -5_000)).toBe(true);
  });

  it("treats higher MAOs / ARV / As-Is as better", () => {
    expect(deltaIsImprovement("arv", 5_000)).toBe(true);
    expect(deltaIsImprovement("wholesale_mao", -5_000)).toBe(false);
    expect(deltaIsImprovement("novation_mao", 5_000)).toBe(true);
  });

  it("returns null for zero diff", () => {
    expect(deltaIsImprovement("arv", 0)).toBeNull();
  });
});
