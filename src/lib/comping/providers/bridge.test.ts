import { describe, expect, it, vi } from "vitest";
import { BridgeProvider } from "./bridge";

function bundle(items: any[]) {
  return new Response(JSON.stringify({ success: true, status: 200, bundle: items }), {
    status: 200,
  });
}

describe("BridgeProvider.resolveSubject", () => {
  it("maps a RESO listing into a SubjectProperty", async () => {
    const fetchImpl = vi.fn(async () =>
      bundle([
        {
          ListingId: "L1",
          UnparsedAddress: "123 Main St, Austin, TX 78701",
          City: "Austin",
          StateOrProvince: "TX",
          PostalCode: "78701",
          Latitude: 30.27,
          Longitude: -97.74,
          BedroomsTotal: 3,
          BathroomsTotalInteger: 2,
          LivingArea: 1500,
          LotSizeSquareFeet: 6500,
          YearBuilt: 1995,
          PropertyType: "Residential",
          PropertySubType: "Single Family Residence",
          GarageSpaces: 2,
        },
      ])
    );
    const p = new BridgeProvider({
      accessToken: "tok",
      dataset: "test",
      fetchImpl: fetchImpl as any,
    });
    const subject = await p.resolveSubject({
      address: "123 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
    });
    expect(subject).toMatchObject({
      address: "123 Main St, Austin, TX 78701",
      city: "Austin",
      state: "TX",
      zip: "78701",
      beds: 3,
      baths: 2,
      sqft: 1500,
      year_built: 1995,
      property_type: "single_family",
      garage_stalls: 2,
    });
  });
});

describe("BridgeProvider.pullComps", () => {
  it("captures ClosePrice + ListPrice + DOM + remarks for solds and lives", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const isSold = url.includes("Closed");
      if (isSold) {
        return bundle([
          {
            ListingId: "S1",
            BedroomsTotal: 3,
            BathroomsTotalInteger: 2,
            LivingArea: 1450,
            ClosePrice: 320_000,
            ListPrice: 325_000,
            OriginalListPrice: 335_000,
            DaysOnMarket: 45,
            CloseDate: "2026-01-15",
            ListDate: "2025-12-01",
            StandardStatus: "Closed",
            PublicRemarks: "Beautifully updated kitchen with new finishes throughout.",
            Latitude: 30.27,
            Longitude: -97.741,
          },
        ]);
      }
      return bundle([
        {
          ListingId: "A1",
          BedroomsTotal: 3,
          BathroomsTotalInteger: 2,
          LivingArea: 1500,
          ListPrice: 340_000,
          DaysOnMarket: 12,
          StandardStatus: "Pending",
          Latitude: 30.27,
          Longitude: -97.742,
        },
      ]);
    });
    const p = new BridgeProvider({
      accessToken: "tok",
      dataset: "test",
      fetchImpl: fetchImpl as any,
    });
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
    const sold = comps.find((c) => c.source_id === "S1")!;
    expect(sold.status).toBe("sold");
    expect(sold.price).toBe(320_000);
    expect(sold.list_price).toBe(325_000);
    expect(sold.original_list_price).toBe(335_000);
    expect(sold.dom_days).toBe(45);
    expect(sold.remarks).toContain("updated kitchen");

    const live = comps.find((c) => c.source_id === "A1")!;
    expect(live.status).toBe("pending");
    expect(live.price).toBe(340_000);
  });

  it("falls back to price=0 when ClosePrice is absent (NDS scenario)", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("Closed")) {
        return bundle([
          {
            ListingId: "S2",
            BedroomsTotal: 3,
            BathroomsTotalInteger: 2,
            LivingArea: 1500,
            ListPrice: 310_000,
            DaysOnMarket: 21,
            StandardStatus: "Closed",
            Latitude: 30.27,
            Longitude: -97.74,
          },
        ]);
      }
      return bundle([]);
    });
    const p = new BridgeProvider({
      accessToken: "tok",
      dataset: "test",
      fetchImpl: fetchImpl as any,
    });
    const comps = await p.pullComps(
      { address: "x", beds: 3, baths: 2, sqft: 1500, property_type: "single_family", lat: 30.27, lng: -97.74 },
      { radiusMi: 0.5, monthsBack: 6 }
    );
    expect(comps[0].price).toBe(0);
    expect(comps[0].list_price).toBe(310_000);
    expect(comps[0].dom_days).toBe(21);
  });
});
