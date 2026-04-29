import { describe, expect, it } from "vitest";
import { buildCompsSnapshot, buildSubjectSnapshot } from "./snapshot";
import type { CompRecord, SubjectProperty } from "./types";

const subject: SubjectProperty = {
  address: "123 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  beds: 3,
  baths: 2,
  sqft: 1500,
  property_type: "single_family",
};

function comp(overrides: Partial<CompRecord> = {}): CompRecord {
  return {
    source: "bridge",
    source_id: "L1",
    status: "sold",
    price: 320_000,
    beds: 3,
    baths: 2,
    sqft: 1500,
    distance_mi: 0.2,
    condition: "renovated",
    is_distressed: false,
    property_type: "single_family",
    ...overrides,
  };
}

describe("buildCompsSnapshot", () => {
  it("returns an empty array for no comps", () => {
    expect(buildCompsSnapshot([])).toEqual([]);
  });

  it("captures the price + condition + imputed flag at the time of analysis", () => {
    const c = comp({ price: 250_000, condition: "as_is", price_imputed: true, list_price: 260_000, dom_days: 45 });
    const snap = buildCompsSnapshot([c])[0];
    expect(snap.price).toBe(250_000);
    expect(snap.condition).toBe("as_is");
    expect(snap.price_imputed).toBe(true);
    expect(snap.list_price).toBe(260_000);
    expect(snap.dom_days).toBe(45);
  });

  it("does not mutate the source comps", () => {
    const c = comp({ price: 300_000 });
    const snap = buildCompsSnapshot([c])[0];
    snap.price = 1; // mutation on the snapshot
    expect(c.price).toBe(300_000);
  });

  it("normalizes undefined optional fields to null for JSONB safety", () => {
    const c = comp({ list_price: undefined, dom_days: undefined, lot_sqft: undefined });
    const snap = buildCompsSnapshot([c])[0];
    expect(snap.list_price).toBeNull();
    expect(snap.dom_days).toBeNull();
    expect(snap.lot_sqft).toBeNull();
  });

  it("treats price_imputed=undefined as false", () => {
    expect(buildCompsSnapshot([comp()])[0].price_imputed).toBe(false);
  });
});

describe("buildSubjectSnapshot", () => {
  it("captures the subject as a flat object with null defaults", () => {
    const snap = buildSubjectSnapshot(subject);
    expect(snap.address).toBe("123 Main St");
    expect(snap.state).toBe("TX");
    expect(snap.beds).toBe(3);
    expect(snap.lot_sqft).toBeNull();
    expect(snap.year_built).toBeNull();
    expect(snap.garage_stalls).toBeNull();
  });

  it("preserves provided optional fields", () => {
    const snap = buildSubjectSnapshot({
      ...subject,
      lot_sqft: 7000,
      year_built: 1995,
      garage_stalls: 2,
    });
    expect(snap.lot_sqft).toBe(7000);
    expect(snap.year_built).toBe(1995);
    expect(snap.garage_stalls).toBe(2);
  });
});
