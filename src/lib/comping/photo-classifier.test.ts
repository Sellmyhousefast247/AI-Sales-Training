import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  classifyConditionsFromPhotos,
  tagCompsByPhotos,
} from "./photo-classifier";
import type { CompRecord } from "./types";

let savedKey: string | undefined;
beforeAll(() => {
  savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => {
  if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
});

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
    condition: "average",
    is_distressed: false,
    property_type: "single_family",
    ...overrides,
  };
}

describe("classifyConditionsFromPhotos", () => {
  it("returns empty for empty input", async () => {
    expect(await classifyConditionsFromPhotos([])).toEqual({});
  });

  it("falls back to {average, null} for every input when no API key is set", async () => {
    const out = await classifyConditionsFromPhotos([
      { id: "c1", photo_urls: ["https://a.example/p1.jpg"] },
      { id: "c2", photo_urls: ["https://b.example/p1.jpg", "https://b.example/p2.jpg"] },
    ]);
    expect(out).toEqual({
      c1: { condition: "average", property_type: null },
      c2: { condition: "average", property_type: null },
    });
  });
});

describe("tagCompsByPhotos", () => {
  it("returns the input unchanged when no comps have photos", async () => {
    const comps = [
      comp({ source_id: "C1", condition: "renovated" }),
      comp({ source_id: "C2", condition: "as_is", photo_urls: [] }),
    ];
    const out = await tagCompsByPhotos(comps);
    expect(out).toEqual(comps);
  });

  it("preserves comps without source_id even if they have photos", async () => {
    const comps = [comp({ source_id: undefined, photo_urls: ["https://x/p.jpg"] })];
    const out = await tagCompsByPhotos(comps);
    expect(out).toEqual(comps);
  });

  it("falls back to 'average' tagging when no API key is set, leaving comp shape intact", async () => {
    const comps = [
      comp({ source_id: "P1", condition: "renovated", photo_urls: ["https://x/p.jpg"] }),
    ];
    const out = await tagCompsByPhotos(comps);
    // No-API-key path: condition gets reset to "average" since the
    // classifier returns that uniformly. property_type is null so the
    // provider's value (single_family) is preserved. Other fields untouched.
    expect(out[0].condition).toBe("average");
    expect(out[0].property_type).toBe("single_family");
    expect(out[0].source_id).toBe("P1");
    expect(out[0].price).toBe(320_000);
  });

  it("stamps condition_source = 'photos' on tagged comps", async () => {
    const comps = [
      comp({ source_id: "P1", condition: "renovated", photo_urls: ["https://x/p.jpg"] }),
    ];
    const out = await tagCompsByPhotos(comps);
    expect(out[0].condition_source).toBe("photos");
  });

  it("does NOT override the provider's property_type when vision returns null", async () => {
    // No-API-key path → property_type comes back as null. Provider's
    // existing type (manufactured here) must be preserved untouched so
    // the engine's strict-type guard keeps working.
    const comps = [
      comp({
        source_id: "P1",
        property_type: "manufactured",
        photo_urls: ["https://x/p.jpg"],
      }),
    ];
    const out = await tagCompsByPhotos(comps);
    expect(out[0].property_type).toBe("manufactured");
  });
});
