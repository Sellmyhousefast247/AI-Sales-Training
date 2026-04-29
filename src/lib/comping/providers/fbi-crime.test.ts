import { describe, expect, it, vi } from "vitest";
import { FbiCrimeProvider } from "./fbi-crime";
import type { SubjectProperty } from "../types";

const subject: SubjectProperty = {
  address: "123 Main St",
  state: "TX",
  beds: 3,
  baths: 2,
  sqft: 1500,
  property_type: "single_family",
};

function fetcherFor(violentRate: number | null, propertyRate: number | null) {
  return vi.fn(async (url: string) => {
    if (url.includes("/violent-crime")) {
      return new Response(
        JSON.stringify(
          violentRate == null ? {} : { results: [{ rate: violentRate }] }
        ),
        { status: 200 }
      );
    }
    if (url.includes("/property-crime")) {
      return new Response(
        JSON.stringify(
          propertyRate == null ? {} : { results: [{ rate: propertyRate }] }
        ),
        { status: 200 }
      );
    }
    return new Response("{}", { status: 200 });
  });
}

describe("FbiCrimeProvider.pullMarketSignals", () => {
  it("returns empty when the subject has no state", async () => {
    const fetchImpl = fetcherFor(380, 1980);
    const p = new FbiCrimeProvider({ apiKey: "k", fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals({ ...subject, state: undefined });
    expect(sig).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("normalizes the U.S. average baseline to ~50", async () => {
    const fetchImpl = fetcherFor(380, 1980);
    const p = new FbiCrimeProvider({ apiKey: "k", fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals(subject);
    expect(sig.crime_index).toBe(50);
  });

  it("scores roughly half-of-baseline rates near 25", async () => {
    const fetchImpl = fetcherFor(190, 990);
    const p = new FbiCrimeProvider({ apiKey: "k", fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals(subject);
    expect(sig.crime_index).toBe(25);
  });

  it("caps the index at 100 for very high rates", async () => {
    const fetchImpl = fetcherFor(2000, 8000);
    const p = new FbiCrimeProvider({ apiKey: "k", fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals(subject);
    expect(sig.crime_index).toBe(100);
  });

  it("falls back to the baseline for the missing series when only one is returned", async () => {
    const fetchImpl = fetcherFor(190, null);
    const p = new FbiCrimeProvider({ apiKey: "k", fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals(subject);
    // violent at half (score 25) + property at baseline (score 50) → avg ~38
    expect(sig.crime_index).toBeGreaterThanOrEqual(35);
    expect(sig.crime_index).toBeLessThanOrEqual(40);
  });

  it("returns empty signals when both endpoints fail or have no data", async () => {
    const fetchImpl = fetcherFor(null, null);
    const p = new FbiCrimeProvider({ apiKey: "k", fetchImpl: fetchImpl as any });
    expect(await p.pullMarketSignals(subject)).toEqual({});
  });
});
