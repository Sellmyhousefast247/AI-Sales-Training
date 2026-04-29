import { describe, expect, it } from "vitest";
import {
  buyingPctAdjustment,
  buyingPctFromPending,
  clampBuyingPct,
  marketAdjustedMAO,
  novationMAO,
  wholesaleMAO,
} from "./formulas";

describe("wholesaleMAO", () => {
  it("matches the spec formula: ARV*0.7 - repairs - 20k", () => {
    expect(wholesaleMAO(250_000, 45_000)).toBe(110_000);
  });

  it("supports a custom wholesale fee", () => {
    expect(wholesaleMAO(300_000, 50_000, 25_000)).toBe(300_000 * 0.7 - 50_000 - 25_000);
  });
});

describe("novationMAO", () => {
  it("matches the playbook example: 185k * 0.9 - 40k", () => {
    expect(novationMAO(185_000)).toBe(126_500);
  });

  it("supports a custom novation fee", () => {
    expect(novationMAO(200_000, 30_000)).toBe(200_000 * 0.9 - 30_000);
  });
});

describe("buyingPctFromPending", () => {
  it.each([
    [10, 0, 0.66],
    [85, 14, 0.66], // 14/99 ≈ 14.1%
    [80, 19, 0.68], // ≈19.2%
    [70, 30, 0.70],
    [60, 40, 0.73],
    [50, 50, 0.75],
  ])("actives=%i pendings=%i → %f", (a, p, expected) => {
    expect(buyingPctFromPending(a, p)).toBe(expected);
  });

  it("falls back to default when there are no listings", () => {
    expect(buyingPctFromPending(0, 0)).toBe(0.7);
  });
});

describe("buyingPctAdjustment", () => {
  it("rewards strong schools and penalizes high crime", () => {
    const delta = buyingPctAdjustment(
      { schools_rating: 8, crime_index: 80 },
      "Light"
    );
    expect(delta).toBe(0.02 - 0.03);
  });

  it("clamps total adjustment between -10% and +5%", () => {
    const big = buyingPctAdjustment(
      {
        schools_rating: 1,
        crime_index: 90,
        has_lot_defects: true,
        near_train_or_busy_road: true,
        is_rural: true,
        appreciation_12mo: -0.05,
        curb_appeal: "poor",
      },
      "Full Gut"
    );
    expect(big).toBe(-0.10);
  });
});

describe("clampBuyingPct", () => {
  it("keeps values in [0.5, 0.85]", () => {
    expect(clampBuyingPct(0.4)).toBe(0.5);
    expect(clampBuyingPct(0.9)).toBe(0.85);
    expect(clampBuyingPct(0.7)).toBe(0.7);
  });
});

describe("marketAdjustedMAO", () => {
  it("uses the supplied buying % instead of the default 70%", () => {
    expect(marketAdjustedMAO(250_000, 45_000, 0.73)).toBe(250_000 * 0.73 - 45_000 - 20_000);
  });
});
