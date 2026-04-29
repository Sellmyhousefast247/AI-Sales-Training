import { describe, expect, it, vi } from "vitest";
import { LotSignalsProvider } from "./lot-signals";
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

interface Routes {
  fema?: unknown;
  overpass?: unknown;
  /** Elevation values returned in the order USGS is hit (4 cardinal points). */
  elevations?: Array<number | null>;
  femaStatus?: number;
  overpassStatus?: number;
}

function fakeFetch(routes: Routes) {
  let elevIdx = 0;
  return vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("hazards.fema.gov") || u.includes("fema")) {
      return new Response(
        JSON.stringify(routes.fema ?? { features: [] }),
        { status: routes.femaStatus ?? 200 }
      );
    }
    if (u.includes("epqs") || u.includes("usgs")) {
      const v = routes.elevations?.[elevIdx++] ?? null;
      const body = v == null ? {} : { value: v };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (u.includes("overpass")) {
      return new Response(
        JSON.stringify(routes.overpass ?? { elements: [] }),
        { status: routes.overpassStatus ?? 200 }
      );
    }
    return new Response("{}", { status: 404 });
  });
}

describe("LotSignalsProvider.pullMarketSignals", () => {
  it("returns empty when the subject has no lat/lng", async () => {
    const fetchImpl = fakeFetch({});
    const p = new LotSignalsProvider({ fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals({ ...subject, lat: undefined, lng: undefined });
    expect(sig).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("flags has_lot_defects when FEMA returns a high-risk flood zone", async () => {
    const fetchImpl = fakeFetch({
      fema: { features: [{ attributes: { FLD_ZONE: "AE" } }] },
    });
    const p = new LotSignalsProvider({ fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals(subject);
    expect(sig.has_lot_defects).toBe(true);
  });

  it("does not flag flood for low-risk zones (e.g. X)", async () => {
    const fetchImpl = fakeFetch({
      fema: { features: [{ attributes: { FLD_ZONE: "X" } }] },
    });
    const p = new LotSignalsProvider({ fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals(subject);
    expect(sig.has_lot_defects).toBeUndefined();
  });

  it("flags has_lot_defects on a steep elevation gradient (slope > threshold)", async () => {
    const fetchImpl = fakeFetch({
      // 4 cardinal points: large drop from N→S → high slope %
      elevations: [500, 460, 480, 480], // 40 ft drop / ~328 ft run ≈ 12.2%
    });
    const p = new LotSignalsProvider({ fetchImpl: fetchImpl as any, slopeThresholdPct: 12 });
    const sig = await p.pullMarketSignals(subject);
    expect(sig.has_lot_defects).toBe(true);
  });

  it("does not flag slope on a flat lot", async () => {
    const fetchImpl = fakeFetch({
      elevations: [500, 500, 501, 500], // 1 ft drop → ~0.3% slope
    });
    const p = new LotSignalsProvider({ fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals(subject);
    expect(sig.has_lot_defects).toBeUndefined();
  });

  it("flags near_train_or_busy_road when Overpass returns matching ways", async () => {
    const fetchImpl = fakeFetch({
      overpass: { elements: [{ type: "count", tags: { ways: "3" } }] },
    });
    const p = new LotSignalsProvider({ fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals(subject);
    expect(sig.near_train_or_busy_road).toBe(true);
  });

  it("does not flag proximity when Overpass returns zero ways", async () => {
    const fetchImpl = fakeFetch({
      overpass: { elements: [{ type: "count", tags: { ways: "0" } }] },
    });
    const p = new LotSignalsProvider({ fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals(subject);
    expect(sig.near_train_or_busy_road).toBeUndefined();
  });

  it("returns empty signals when every upstream is empty or fails", async () => {
    const fetchImpl = fakeFetch({
      fema: { features: [] },
      overpass: { elements: [] },
      elevations: [null, null, null, null],
    });
    const p = new LotSignalsProvider({ fetchImpl: fetchImpl as any });
    expect(await p.pullMarketSignals(subject)).toEqual({});
  });

  it("merges signals from multiple positive upstreams in one call", async () => {
    const fetchImpl = fakeFetch({
      fema: { features: [{ attributes: { FLD_ZONE: "AE" } }] },
      overpass: { elements: [{ type: "count", tags: { ways: "1" } }] },
      elevations: [500, 500, 500, 500],
    });
    const p = new LotSignalsProvider({ fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals(subject);
    expect(sig).toEqual({
      has_lot_defects: true,
      near_train_or_busy_road: true,
    });
  });
});
