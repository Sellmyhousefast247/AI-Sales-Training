import { describe, expect, it, vi } from "vitest";
import { AttomProvider } from "./attom";

function mockFetch(handler: (url: string) => unknown) {
  return vi.fn(async (url: string) => {
    const data = handler(url);
    return new Response(JSON.stringify(data), { status: 200 });
  });
}

describe("AttomProvider.resolveSubject", () => {
  it("maps a property/expandedprofile response into a SubjectProperty", async () => {
    const fetchImpl = mockFetch(() => ({
      property: [
        {
          address: {
            line1: "123 Main St",
            locality: "Austin",
            countrySubd: "TX",
            postal1: "78701",
          },
          location: { latitude: 30.27, longitude: -97.74 },
          building: {
            rooms: { beds: 3, bathstotal: 2 },
            size: { universalsize: 1500 },
            parking: { prkgSpaces: 1 },
          },
          lot: { lotsize2: 6500 },
          summary: { yearbuilt: 1995, propclass: "Single Family Residence" },
        },
      ],
    }));

    const p = new AttomProvider({ apiKey: "test", fetchImpl: fetchImpl as any });
    const subject = await p.resolveSubject({ address: "123 Main St", city: "Austin", state: "TX", zip: "78701" });

    expect(subject).toMatchObject({
      address: "123 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
      beds: 3,
      baths: 2,
      sqft: 1500,
      lot_sqft: 6500,
      year_built: 1995,
      property_type: "single_family",
      garage_stalls: 1,
    });
  });

  it("returns null when ATTOM returns no property", async () => {
    const fetchImpl = mockFetch(() => ({ property: [] }));
    const p = new AttomProvider({ apiKey: "test", fetchImpl: fetchImpl as any });
    const subject = await p.resolveSubject({ address: "404 Nowhere", city: "X", state: "TX" });
    expect(subject).toBeNull();
  });
});

describe("AttomProvider.pullComps", () => {
  it("maps sold + active responses into CompRecords", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const body = url.includes("/sale/snapshot")
        ? {
            property: [
              {
                identifier: { attomId: "S1" },
                address: { line1: "100 Oak" },
                location: { latitude: 30.27, longitude: -97.741 },
                building: { rooms: { beds: 3, bathstotal: 2 }, size: { universalsize: 1450 } },
                sale: { amount: { saleamt: 320_000 }, salesearchdate: "2026-01-15" },
                summary: { yearbuilt: 1990 },
              },
            ],
          }
        : {
            property: [
              {
                identifier: { attomId: "A1" },
                address: { line1: "200 Pine" },
                location: { latitude: 30.27, longitude: -97.742 },
                building: { rooms: { beds: 3, bathstotal: 2 }, size: { universalsize: 1500 } },
                assessment: { market: { mktttlvalue: 340_000 } },
                summary: { yearbuilt: 1992 },
              },
            ],
          };
      return new Response(JSON.stringify(body), { status: 200 });
    });

    const p = new AttomProvider({ apiKey: "test", fetchImpl: fetchImpl as any });
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
    expect(comps[0]).toMatchObject({ source: "attom", status: "sold", price: 320_000 });
    expect(comps[1]).toMatchObject({ source: "attom", status: "active", price: 340_000 });
    expect(comps[0].distance_mi).toBeGreaterThan(0);
  });

  it("extracts photo URLs from media[] and dedupes/caps at 5", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const property = url.includes("/sale/snapshot")
        ? [
            {
              identifier: { attomId: "S1" },
              location: { latitude: 30.27, longitude: -97.74 },
              building: { rooms: { beds: 3, bathstotal: 2 }, size: { universalsize: 1500 } },
              sale: { amount: { saleamt: 300_000 } },
              media: [
                { PhotoURL: "https://x/1.jpg" },
                { photoURL: "https://x/2.jpg" }, // alternate casing
                { url: "https://x/3.jpg" },
                { PhotoURL: "https://x/4.jpg" },
                { PhotoURL: "https://x/5.jpg" },
                { PhotoURL: "https://x/6.jpg" },
                { PhotoURL: "https://x/1.jpg" }, // duplicate
              ],
            },
          ]
        : [];
      return new Response(JSON.stringify({ property }), { status: 200 });
    });
    const p = new AttomProvider({ apiKey: "k", fetchImpl: fetchImpl as any });
    const comps = await p.pullComps(
      { address: "x", beds: 3, baths: 2, sqft: 1500, property_type: "single_family", lat: 30.27, lng: -97.74 },
      { radiusMi: 0.5, monthsBack: 6 }
    );
    expect(comps[0].photo_urls).toEqual([
      "https://x/1.jpg",
      "https://x/2.jpg",
      "https://x/3.jpg",
      "https://x/4.jpg",
      "https://x/5.jpg",
    ]);
  });

  it("leaves photo_urls undefined when ATTOM returns no media", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const property = url.includes("/sale/snapshot")
        ? [
            {
              identifier: { attomId: "S2" },
              location: { latitude: 30.27, longitude: -97.74 },
              building: { rooms: { beds: 3, bathstotal: 2 }, size: { universalsize: 1500 } },
              sale: { amount: { saleamt: 280_000 } },
            },
          ]
        : [];
      return new Response(JSON.stringify({ property }), { status: 200 });
    });
    const p = new AttomProvider({ apiKey: "k", fetchImpl: fetchImpl as any });
    const comps = await p.pullComps(
      { address: "x", beds: 3, baths: 2, sqft: 1500, property_type: "single_family", lat: 30.27, lng: -97.74 },
      { radiusMi: 0.5, monthsBack: 6 }
    );
    expect(comps[0].photo_urls).toBeUndefined();
  });
});
