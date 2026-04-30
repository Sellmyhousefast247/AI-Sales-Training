import { describe, expect, it } from "vitest";
import {
  applyConfidenceDrop,
  crossCheckAvms,
  type AvmEstimate,
} from "./avm-cross-check";

const avm = (source: string, arv: number): AvmEstimate => ({ source, arv });

describe("crossCheckAvms", () => {
  it("returns an empty result when there are no AVMs", () => {
    expect(crossCheckAvms(300_000, [])).toEqual({
      max_spread_pct: 0,
      estimates: [],
      confidence_drop: 0,
      warning: null,
    });
  });

  it("ignores AVMs with non-positive prices", () => {
    const out = crossCheckAvms(300_000, [avm("rentcast", 0), avm("attom", -1)]);
    expect(out.estimates).toEqual([]);
    expect(out.confidence_drop).toBe(0);
  });

  it("returns no drop when all AVMs are within 15% of ARV", () => {
    const out = crossCheckAvms(300_000, [
      avm("rentcast", 295_000),
      avm("attom", 320_000),
    ]);
    expect(out.confidence_drop).toBe(0);
    expect(out.warning).toBeNull();
    expect(out.max_spread_pct).toBeGreaterThan(0);
  });

  it("drops confidence one tier when max spread is between 15% and 25%", () => {
    // 360k / 300k = 1.20 → 20% spread
    const out = crossCheckAvms(300_000, [avm("rentcast", 360_000)]);
    expect(out.confidence_drop).toBe(1);
    expect(out.max_spread_pct).toBe(0.2);
    expect(out.warning).toContain("max spread 20%");
    expect(out.warning).toContain("rentcast");
  });

  it("drops confidence two tiers when max spread is at or above 25%", () => {
    // 240k / 300k = 0.80 → 20% one way; 400k = 33% the other.
    const out = crossCheckAvms(300_000, [
      avm("rentcast", 240_000),
      avm("attom", 400_000),
    ]);
    expect(out.confidence_drop).toBe(2);
    expect(out.max_spread_pct).toBeCloseTo(0.333, 2);
  });

  it("returns no drop when ARV is non-positive", () => {
    expect(crossCheckAvms(0, [avm("rentcast", 300_000)]).confidence_drop).toBe(0);
  });
});

describe("applyConfidenceDrop", () => {
  it("keeps confidence unchanged when drop is 0", () => {
    expect(applyConfidenceDrop("High", 0)).toBe("High");
    expect(applyConfidenceDrop("Medium", 0)).toBe("Medium");
    expect(applyConfidenceDrop("Low", 0)).toBe("Low");
  });

  it("drops one tier", () => {
    expect(applyConfidenceDrop("High", 1)).toBe("Medium");
    expect(applyConfidenceDrop("Medium", 1)).toBe("Low");
  });

  it("drops two tiers", () => {
    expect(applyConfidenceDrop("High", 2)).toBe("Low");
  });

  it("clamps at Low — never drops below it", () => {
    expect(applyConfidenceDrop("Low", 1)).toBe("Low");
    expect(applyConfidenceDrop("Low", 2)).toBe("Low");
    expect(applyConfidenceDrop("Medium", 2)).toBe("Low");
  });
});
