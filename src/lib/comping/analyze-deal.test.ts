import { describe, expect, it } from "vitest";
import { analyzeDeal } from "./index";
import type { CompRecord, SubjectProperty } from "./types";

const subject: SubjectProperty = {
  address: "123 Test St",
  beds: 3,
  baths: 2,
  sqft: 1500,
  lot_sqft: 7000,
  year_built: 1990,
  property_type: "single_family",
};

function comp(p: Partial<CompRecord>): CompRecord {
  return {
    source: "test",
    source_id: Math.random().toString(36).slice(2),
    status: "sold",
    price: 300_000,
    close_date: new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10),
    beds: 3,
    baths: 2,
    sqft: 1500,
    distance_mi: 0.2,
    condition: "average",
    is_distressed: false,
    property_type: "single_family",
    ...p,
  };
}

describe("analyzeDeal end-to-end", () => {
  it("produces a sane offer when fed clean renovated solds + a heavy condition note", () => {
    const comps: CompRecord[] = [
      comp({ price: 320_000, condition: "renovated", distance_mi: 0.15 }),
      comp({ price: 315_000, condition: "renovated", distance_mi: 0.22 }),
      comp({ price: 325_000, condition: "renovated", distance_mi: 0.30 }),
      comp({ price: 318_000, condition: "renovated", distance_mi: 0.18 }),
      comp({ price: 322_000, condition: "renovated", distance_mi: 0.25 }),
      comp({ price: 240_000, condition: "as_is", distance_mi: 0.20 }),
      comp({ price: 245_000, condition: "as_is", distance_mi: 0.28 }),
      comp({ price: 250_000, condition: "as_is", distance_mi: 0.19 }),
      comp({ status: "active", price: 330_000, condition: "renovated", distance_mi: 0.3 }),
      comp({ status: "active", price: 335_000, condition: "renovated", distance_mi: 0.4 }),
      comp({ status: "pending", price: 320_000, condition: "renovated", distance_mi: 0.35 }),
    ];

    const result = analyzeDeal({
      subject,
      condition_text: "Needs new roof, full kitchen, full bath, windows, and siding.",
      comps,
      market_signals: { schools_rating: 7 },
      wholesale_fee: 20_000,
      novation_fee: 40_000,
    });

    // ARV around 320k.
    expect(result.arv).toBeGreaterThan(310_000);
    expect(result.arv).toBeLessThan(330_000);

    // As-Is around 245k.
    expect(result.as_is_value).toBeGreaterThan(235_000);
    expect(result.as_is_value).toBeLessThan(260_000);

    // Heavy rehab → 35–55 $/sqft × 1500 → ~$67.5k point.
    expect(result.repair_breakdown.level).toBe("Heavy");
    expect(result.repair_estimate).toBeGreaterThan(50_000);
    expect(result.repair_estimate).toBeLessThan(85_000);

    // Pending ratio = 1/3 → 70% bracket. Schools 7 nudges +2%.
    expect(result.buying_pct).toBeGreaterThanOrEqual(0.70);
    expect(result.buying_pct).toBeLessThanOrEqual(0.74);

    // Spec formulas.
    expect(result.wholesale_mao).toBe(
      Math.round(result.arv * 0.7 - result.repair_estimate - 20_000)
    );
    expect(result.novation_mao).toBe(
      Math.round(result.as_is_value * 0.9 - 40_000)
    );

    expect(["Low", "Medium", "High"]).toContain(result.confidence_score);
  });

  it("warns and falls back gracefully when comps are missing", () => {
    const result = analyzeDeal({
      subject,
      condition_text: "Light cosmetic only.",
      comps: [],
      market_signals: {},
      wholesale_fee: 20_000,
      novation_fee: 40_000,
    });
    expect(result.confidence_score).toBe("Low");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.repair_breakdown.level).toBe("Light");
  });
});
