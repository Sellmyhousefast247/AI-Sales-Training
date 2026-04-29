import { describe, expect, it, vi } from "vitest";
import { GreatSchoolsProvider } from "./greatschools";
import type { SubjectProperty } from "../types";

const subject: SubjectProperty = {
  address: "123 Main St",
  state: "TX",
  beds: 3,
  baths: 2,
  sqft: 1500,
  property_type: "single_family",
  lat: 30.27,
  lng: -97.74,
};

function mockFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("GreatSchoolsProvider.pullMarketSignals", () => {
  it("returns empty when the subject has no lat/lng", async () => {
    const fetchImpl = mockFetch({});
    const p = new GreatSchoolsProvider({ apiKey: "k", fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals({ ...subject, lat: undefined, lng: undefined });
    expect(sig).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("averages gsRating across nearby schools", async () => {
    const fetchImpl = mockFetch({
      schools: [
        { gsRating: 8, type: "elementary" },
        { gsRating: 6, type: "middle" },
        { gsRating: 7, type: "high" },
      ],
    });
    const p = new GreatSchoolsProvider({ apiKey: "k", fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals(subject);
    // (8 + 6 + 7) / 3 = 7.0
    expect(sig.schools_rating).toBe(7);
  });

  it("weights school types equally so a single bad school doesn't dominate", async () => {
    const fetchImpl = mockFetch({
      schools: [
        { gsRating: 2, type: "elementary" },
        { gsRating: 2, type: "elementary" },
        { gsRating: 9, type: "high" },
      ],
    });
    const p = new GreatSchoolsProvider({ apiKey: "k", fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals(subject);
    // elementary avg 2, high avg 9 → bucket avg = 5.5
    expect(sig.schools_rating).toBe(5.5);
  });

  it("tolerates a top-level array response", async () => {
    const fetchImpl = mockFetch([{ rating: 5 }, { rating: 7 }]);
    const p = new GreatSchoolsProvider({ apiKey: "k", fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals(subject);
    expect(sig.schools_rating).toBe(6);
  });

  it("returns empty signals on a fetch error", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 503 }));
    const p = new GreatSchoolsProvider({ apiKey: "k", fetchImpl: fetchImpl as any });
    expect(await p.pullMarketSignals(subject)).toEqual({});
  });
});
