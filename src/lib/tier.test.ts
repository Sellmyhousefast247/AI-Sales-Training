import { describe, it, expect } from "vitest";
import { computeRepTier, tierFromAverage } from "./tier";

describe("tierFromAverage", () => {
  it("maps boundary scores correctly", () => {
    expect(tierFromAverage(0)).toBe(1);
    expect(tierFromAverage(4.99)).toBe(1);
    expect(tierFromAverage(5.0)).toBe(2);
    expect(tierFromAverage(6.49)).toBe(2);
    expect(tierFromAverage(6.5)).toBe(3);
    expect(tierFromAverage(7.99)).toBe(3);
    expect(tierFromAverage(8.0)).toBe(4);
    expect(tierFromAverage(8.99)).toBe(4);
    expect(tierFromAverage(9.0)).toBe(5);
    expect(tierFromAverage(10)).toBe(5);
  });
});

describe("computeRepTier", () => {
  const make = (n: number, avg = 7) =>
    Array.from({ length: n }, (_, i) => ({
      average_score: avg,
      created_at: new Date(2025, 0, i + 1).toISOString(),
    }));

  it("returns Tier 1 with no scores", () => {
    expect(computeRepTier({ scores: [], window: "last_10" }).tier).toBe(1);
  });

  it("floors to Tier 1 below min calls even with high avg", () => {
    const r = computeRepTier({ scores: make(3, 9.5), window: "last_10", minCallsToLeaveTier1: 5 });
    expect(r.tier).toBe(1);
  });

  it("promotes once past min calls", () => {
    const r = computeRepTier({ scores: make(5, 9.5), window: "last_10" });
    expect(r.tier).toBe(5);
  });

  it("uses last 10 only", () => {
    const all = make(20, 5.0).concat(make(5, 9.5).map((s, i) => ({
      ...s,
      created_at: new Date(2025, 1, i + 1).toISOString(),
    })));
    const r = computeRepTier({ scores: all, window: "last_10" });
    // Last 10 by date should include the 5 recent 9.5s and 5 of the older 5.0s
    // So avg = (5*9.5 + 5*5.0)/10 = 7.25 → Tier 3
    expect(r.tier).toBe(3);
  });

  it("respects last_30d window", () => {
    const now = new Date("2025-04-25T00:00:00Z");
    const old = {
      average_score: 9,
      created_at: new Date("2025-01-01T00:00:00Z").toISOString(),
    };
    const recent = make(5, 6.5).map((s, i) => ({
      ...s,
      created_at: new Date(2025, 3, 10 + i).toISOString(),
    }));
    const r = computeRepTier({ scores: [old, ...recent], window: "last_30d", now });
    expect(r.sample_size).toBe(5);
    expect(r.tier).toBe(3);
  });
});
