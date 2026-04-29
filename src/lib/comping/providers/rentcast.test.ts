import { describe, expect, it, vi } from "vitest";
import { RentCastProvider, computeAppreciation12mo } from "./rentcast";

describe("RentCastProvider.resolveSubject", () => {
  it("maps a /properties response into a SubjectProperty", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            formattedAddress: "123 Main St, Austin, TX 78701",
            city: "Austin",
            state: "TX",
            zipCode: "78701",
            latitude: 30.27,
            longitude: -97.74,
            bedrooms: 3,
            bathrooms: 2,
            squareFootage: 1500,
            lotSize: 6500,
            yearBuilt: 1995,
            propertyType: "Single Family",
            features: { garageSpaces: 2 },
          },
        ]),
        { status: 200 }
      )
    );
    const p = new RentCastProvider({ apiKey: "test", fetchImpl: fetchImpl as any });
    const subject = await p.resolveSubject({ address: "123 Main St", city: "Austin", state: "TX", zip: "78701" });
    expect(subject).toMatchObject({
      beds: 3,
      baths: 2,
      sqft: 1500,
      lot_sqft: 6500,
      year_built: 1995,
      property_type: "single_family",
      garage_stalls: 2,
    });
  });
});

describe("RentCastProvider.pullComps", () => {
  it("merges AVM comparables and sale listings", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/avm/value")) {
        return new Response(
          JSON.stringify({
            comparables: [
              {
                id: "C1",
                bedrooms: 3,
                bathrooms: 2,
                squareFootage: 1450,
                price: 320_000,
                lastSaleDate: "2026-01-15",
                distance: 0.21,
                propertyType: "Single Family",
              },
            ],
          }),
          { status: 200 }
        );
      }
      // listings
      return new Response(
        JSON.stringify([
          {
            id: "L1",
            bedrooms: 3,
            bathrooms: 2,
            squareFootage: 1500,
            listPrice: 340_000,
            status: "Pending",
            propertyType: "Single Family",
            latitude: 30.27,
            longitude: -97.74,
          },
        ]),
        { status: 200 }
      );
    });

    const p = new RentCastProvider({ apiKey: "test", fetchImpl: fetchImpl as any });
    const comps = await p.pullComps(
      {
        address: "150 Center",
        beds: 3,
        baths: 2,
        sqft: 1500,
        property_type: "single_family",
        lat: 30.27,
        lng: -97.74,
      },
      { radiusMi: 0.5, monthsBack: 6 }
    );

    expect(comps).toHaveLength(2);
    expect(comps.find((c) => c.source_id === "C1")).toMatchObject({
      status: "sold",
      price: 320_000,
      distance_mi: 0.21,
    });
    expect(comps.find((c) => c.source_id === "L1")).toMatchObject({
      status: "pending",
      price: 340_000,
    });
  });

  it("extracts photos from images / photos / propertyImages with dedupe + cap", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/avm/value")) {
        return new Response(
          JSON.stringify({
            comparables: [
              {
                id: "C1",
                bedrooms: 3,
                bathrooms: 2,
                squareFootage: 1500,
                price: 300_000,
                photos: [
                  "https://r/1.jpg",
                  { url: "https://r/2.jpg" },
                  { imageUrl: "https://r/3.jpg" },
                  { photoUrl: "https://r/4.jpg" },
                  "https://r/5.jpg",
                  "https://r/6.jpg",
                  "https://r/1.jpg", // dup
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify([
          {
            id: "L1",
            bedrooms: 3,
            bathrooms: 2,
            squareFootage: 1500,
            listPrice: 340_000,
            status: "Active",
            images: ["https://r/listing-1.jpg", "https://r/listing-2.jpg"],
          },
        ]),
        { status: 200 }
      );
    });
    const p = new RentCastProvider({ apiKey: "test", fetchImpl: fetchImpl as any });
    const comps = await p.pullComps(
      { address: "x", beds: 3, baths: 2, sqft: 1500, property_type: "single_family", lat: 30.27, lng: -97.74 },
      { radiusMi: 0.5, monthsBack: 6 }
    );
    const sold = comps.find((c) => c.source_id === "C1")!;
    expect(sold.photo_urls).toEqual([
      "https://r/1.jpg",
      "https://r/2.jpg",
      "https://r/3.jpg",
      "https://r/4.jpg",
      "https://r/5.jpg",
    ]);
    const live = comps.find((c) => c.source_id === "L1")!;
    expect(live.photo_urls).toEqual([
      "https://r/listing-1.jpg",
      "https://r/listing-2.jpg",
    ]);
  });

  it("leaves photo_urls undefined when no image fields are present", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/avm/value")) {
        return new Response(
          JSON.stringify({
            comparables: [
              { id: "C1", bedrooms: 3, bathrooms: 2, squareFootage: 1500, price: 300_000 },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response("[]", { status: 200 });
    });
    const p = new RentCastProvider({ apiKey: "test", fetchImpl: fetchImpl as any });
    const comps = await p.pullComps(
      { address: "x", beds: 3, baths: 2, sqft: 1500, property_type: "single_family", lat: 30.27, lng: -97.74 },
      { radiusMi: 0.5, monthsBack: 6 }
    );
    expect(comps[0].photo_urls).toBeUndefined();
  });
});

describe("computeAppreciation12mo", () => {
  function history(points: Array<[string, number]>) {
    return {
      history: Object.fromEntries(
        points.map(([k, v]) => [k, { medianPrice: v }])
      ),
    };
  }

  it("returns null for missing or short history", () => {
    expect(computeAppreciation12mo(null)).toBeNull();
    expect(computeAppreciation12mo({})).toBeNull();
    expect(
      computeAppreciation12mo(
        history([
          ["2024-10", 500_000],
          ["2024-11", 510_000],
          ["2024-12", 520_000],
        ])
      )
    ).toBeNull();
  });

  it("computes appreciation between exact 12-mo-prior and latest", () => {
    const out = computeAppreciation12mo(
      history([
        ["2024-01", 500_000],
        ["2024-04", 510_000],
        ["2024-07", 520_000],
        ["2024-10", 540_000],
        ["2024-12", 545_000],
        ["2025-01", 560_000], // latest; 12-mo prior is 2024-01 = 500k
      ])
    );
    expect(out).toBeCloseTo(0.12, 2); // (560-500)/500 = 0.12
  });

  it("falls back to averagePrice when medianPrice is missing", () => {
    const out = computeAppreciation12mo({
      history: {
        "2024-01": { averagePrice: 600_000 },
        "2024-04": { averagePrice: 605_000 },
        "2024-07": { averagePrice: 610_000 },
        "2024-10": { averagePrice: 620_000 },
        "2024-12": { averagePrice: 625_000 },
        "2025-01": { averagePrice: 630_000 },
      },
    });
    expect(out).toBeCloseTo(0.05, 2);
  });

  it("returns null when the earlier point is zero", () => {
    expect(
      computeAppreciation12mo(
        history([
          ["2024-01", 0],
          ["2024-04", 100],
          ["2024-07", 200],
          ["2024-10", 300],
          ["2024-12", 400],
          ["2025-01", 500],
        ])
      )
    ).toBeNull();
  });
});

describe("RentCastProvider.pullMarketSignals", () => {
  function makeFetch(saleData: unknown) {
    return vi.fn(async () => new Response(JSON.stringify({ saleData }), { status: 200 }));
  }

  it("returns empty when the subject has no zip", async () => {
    const fetchImpl = makeFetch({});
    const p = new RentCastProvider({ apiKey: "k", fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals({
      address: "x",
      beds: 3,
      baths: 2,
      sqft: 1500,
      property_type: "single_family",
    });
    expect(sig).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("emits appreciation_12mo computed from history", async () => {
    const fetchImpl = makeFetch({
      history: {
        "2024-01": { medianPrice: 500_000 },
        "2024-04": { medianPrice: 510_000 },
        "2024-07": { medianPrice: 520_000 },
        "2024-10": { medianPrice: 540_000 },
        "2024-12": { medianPrice: 545_000 },
        "2025-01": { medianPrice: 560_000 },
      },
    });
    const p = new RentCastProvider({ apiKey: "k", fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals({
      address: "x",
      zip: "78701",
      beds: 3,
      baths: 2,
      sqft: 1500,
      property_type: "single_family",
    });
    expect(sig.appreciation_12mo).toBeCloseTo(0.12, 2);
  });

  it("returns empty signals when the markets endpoint fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 503 }));
    const p = new RentCastProvider({ apiKey: "k", fetchImpl: fetchImpl as any });
    const sig = await p.pullMarketSignals({
      address: "x",
      zip: "78701",
      beds: 3,
      baths: 2,
      sqft: 1500,
      property_type: "single_family",
    });
    expect(sig).toEqual({});
  });
});
