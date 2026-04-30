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

describe("analyzeDeal property-type guarding", () => {
  function makeRenovatedSet(propertyType: CompRecord["property_type"]): CompRecord[] {
    // 5 close, similar comps in the given property type so the
    // pipeline has enough surviving comps to produce an ARV.
    return [
      comp({ price: 320_000, condition: "renovated", distance_mi: 0.12, property_type: propertyType }),
      comp({ price: 318_000, condition: "renovated", distance_mi: 0.16, property_type: propertyType }),
      comp({ price: 315_000, condition: "renovated", distance_mi: 0.21, property_type: propertyType }),
      comp({ price: 322_000, condition: "renovated", distance_mi: 0.24, property_type: propertyType }),
      comp({ price: 319_000, condition: "renovated", distance_mi: 0.18, property_type: propertyType }),
    ];
  }

  it("does NOT comp a manufactured subject against single-family solds", () => {
    const mfgSubject: SubjectProperty = { ...subject, property_type: "manufactured" };
    const result = analyzeDeal({
      subject: mfgSubject,
      condition_text: "",
      comps: makeRenovatedSet("single_family"),
      market_signals: {},
      wholesale_fee: 20_000,
      novation_fee: 40_000,
    });
    expect(result.arv).toBe(0);
    expect(result.warnings.some((w) => /manufactured/i.test(w))).toBe(true);
    expect(result.warnings.some((w) => /falling back is disabled/i.test(w))).toBe(true);
  });

  it("does NOT comp a multi-family subject against single-family solds", () => {
    const mf: SubjectProperty = { ...subject, property_type: "multi_family" };
    const result = analyzeDeal({
      subject: mf,
      condition_text: "",
      comps: makeRenovatedSet("single_family"),
      market_signals: {},
      wholesale_fee: 20_000,
      novation_fee: 40_000,
    });
    expect(result.arv).toBe(0);
    expect(result.warnings.some((w) => /multi family/i.test(w))).toBe(true);
  });

  it("falls back from single_family to townhouse comps and warns about it", () => {
    const result = analyzeDeal({
      subject,
      condition_text: "",
      comps: makeRenovatedSet("townhouse"),
      market_signals: {},
      wholesale_fee: 20_000,
      novation_fee: 40_000,
    });
    expect(result.arv).toBeGreaterThan(0);
    expect(result.warnings.some((w) => /fell back to compatible/i.test(w))).toBe(true);
  });

  it("does not warn when same-type comps are sufficient", () => {
    const result = analyzeDeal({
      subject,
      condition_text: "",
      comps: makeRenovatedSet("single_family"),
      market_signals: {},
      wholesale_fee: 20_000,
      novation_fee: 40_000,
    });
    expect(result.arv).toBeGreaterThan(0);
    expect(result.warnings.some((w) => /fell back/i.test(w))).toBe(false);
  });

  it("keeps condo strict — does not fall back to single_family", () => {
    const cd: SubjectProperty = { ...subject, property_type: "condo" };
    const result = analyzeDeal({
      subject: cd,
      condition_text: "",
      comps: makeRenovatedSet("single_family"),
      market_signals: {},
      wholesale_fee: 20_000,
      novation_fee: 40_000,
    });
    expect(result.arv).toBe(0);
    expect(result.warnings.some((w) => /Insufficient sold comps for ARV/i.test(w))).toBe(true);
  });
});
