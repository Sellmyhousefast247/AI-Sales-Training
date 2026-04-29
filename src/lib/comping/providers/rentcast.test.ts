import { describe, expect, it, vi } from "vitest";
import { RentCastProvider } from "./rentcast";

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
