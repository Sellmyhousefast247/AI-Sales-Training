import { describe, expect, it } from "vitest";
import {
  imputeMissingPrices,
  imputeSalePrice,
  inferSaleToListRatio,
  isNonDisclosureState,
  rankBySimilarity,
  similarityScore,
} from "./non-disclosure";
import type { CompRecord, SubjectProperty } from "./types";

const subject: SubjectProperty = {
  address: "150 Center St",
  state: "TX",
  beds: 3,
  baths: 2,
  sqft: 1500,
  year_built: 1995,
  property_type: "single_family",
};

function comp(overrides: Partial<CompRecord> = {}): CompRecord {
  return {
    source: "attom",
    source_id: Math.random().toString(36).slice(2),
    status: "sold",
    price: 0,
    beds: 3,
    baths: 2,
    sqft: 1500,
    distance_mi: 0.2,
    condition: "average",
    is_distressed: false,
    property_type: "single_family",
    ...overrides,
  };
}

describe("isNonDisclosureState", () => {
  it.each(["TX", "tx", "Tx"])("treats %s as non-disclosure", (s) => {
    expect(isNonDisclosureState(s)).toBe(true);
  });
  it.each(["CA", "FL", "NY", undefined, null, ""])("treats %s as disclosure", (s) => {
    expect(isNonDisclosureState(s as any)).toBe(false);
  });
});

describe("inferSaleToListRatio", () => {
  it("returns higher ratios for hotter markets", () => {
    expect(inferSaleToListRatio(50, 50)).toBeGreaterThanOrEqual(1.02); // 50% pending
    expect(inferSaleToListRatio(60, 40)).toBeGreaterThanOrEqual(1.0);
    expect(inferSaleToListRatio(80, 10)).toBeLessThan(0.97); // ~11% pending → soft
  });
  it("falls back to 0.97 with no listings", () => {
    expect(inferSaleToListRatio(0, 0)).toBe(0.97);
  });
});

describe("imputeSalePrice", () => {
  it("returns null when there's no list price", () => {
    expect(imputeSalePrice(comp(), 0.97)).toBeNull();
  });
  it("applies the sale-to-list ratio", () => {
    expect(imputeSalePrice(comp({ list_price: 300_000 }), 0.98)).toBe(294_000);
  });
  it("penalizes long DOM up to 6%", () => {
    const fast = imputeSalePrice(comp({ list_price: 300_000, dom_days: 15 }), 1.0);
    const slow = imputeSalePrice(comp({ list_price: 300_000, dom_days: 200 }), 1.0);
    expect(fast).toBe(300_000);
    expect(slow).toBeLessThan(fast!);
    expect(slow).toBeGreaterThanOrEqual(300_000 * 0.94); // penalty cap
  });
  it("uses original_list_price when current list_price is missing", () => {
    expect(imputeSalePrice(comp({ original_list_price: 320_000 }), 0.95)).toBe(304_000);
  });
});

describe("imputeMissingPrices", () => {
  it("fills in missing sold prices for non-disclosure states", () => {
    const comps: CompRecord[] = [
      comp({ status: "sold", price: 0, list_price: 300_000, dom_days: 20 }),
      comp({ status: "sold", price: 290_000, source: "bridge" }), // MLS — leave alone
      comp({ status: "active", price: 320_000, list_price: 320_000 }),
      comp({ status: "active", price: 330_000, list_price: 330_000 }),
      comp({ status: "pending", price: 325_000, list_price: 325_000 }),
    ];
    const out = imputeMissingPrices(subject, comps, {});
    expect(out[0].price_imputed).toBe(true);
    expect(out[0].price).toBeGreaterThan(0);
    // Bridge MLS comp untouched.
    expect(out[1].price).toBe(290_000);
    expect(out[1].price_imputed).toBeUndefined();
  });

  it("leaves comps alone in disclosure states", () => {
    const subjectCA = { ...subject, state: "CA" };
    const comps: CompRecord[] = [
      comp({ status: "sold", price: 0, list_price: 300_000 }),
    ];
    const out = imputeMissingPrices(subjectCA, comps, {});
    expect(out[0].price).toBe(0);
    expect(out[0].price_imputed).toBeUndefined();
  });
});

describe("similarityScore + rankBySimilarity", () => {
  it("scores identical-spec comps highest", () => {
    const exact = comp({ beds: 3, baths: 2, sqft: 1500, distance_mi: 0.1, year_built: 1995 });
    const off = comp({ beds: 4, baths: 3, sqft: 1800, distance_mi: 0.6, year_built: 1970 });
    expect(similarityScore(subject, exact)).toBeGreaterThan(similarityScore(subject, off));
  });

  it("rankBySimilarity orders best-match first and respects topN", () => {
    const a = comp({ sqft: 1500, distance_mi: 0.1 });
    const b = comp({ sqft: 1700, distance_mi: 0.4 });
    const c = comp({ sqft: 1300, distance_mi: 0.2 });
    const ranked = rankBySimilarity(subject, [b, c, a], 2);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]).toBe(a);
  });
});
