import { describe, expect, it, vi } from "vitest";
import { warmZip } from "./warmer";
import { ProviderRouter } from "./providers/types";
import type { CompDataProvider } from "./providers/types";
import type { MarketSignals, SubjectProperty } from "./types";

function fakeProvider(name: string, signals: MarketSignals): CompDataProvider {
  return {
    name,
    resolveSubject: async () => null,
    pullComps: async () => [],
    pullMarketSignals: async () => signals,
  };
}

describe("warmZip", () => {
  it("returns ok=false with a clear error when no providers are configured", async () => {
    const result = await warmZip({ companyId: "c1" }, "78701", "TX", "Austin", {
      router: null,
      persist: false,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No signal providers/i);
    expect(result.signals).toEqual({});
  });

  it("merges signals from every provider's pullMarketSignals", async () => {
    const router = new ProviderRouter([
      fakeProvider("schools", { schools_rating: 7 }),
      fakeProvider("crime", { crime_index: 35 }),
    ]);
    const result = await warmZip({ companyId: "c1" }, "78701", "TX", "Austin", {
      router,
      persist: false,
    });
    expect(result.ok).toBe(true);
    expect(result.signals).toEqual({ schools_rating: 7, crime_index: 35 });
  });

  it("builds a synthetic subject pinned to the supplied zip + state", async () => {
    const seen: SubjectProperty[] = [];
    const recorder: CompDataProvider = {
      name: "rec",
      resolveSubject: async () => null,
      pullComps: async () => [],
      pullMarketSignals: async (s) => {
        seen.push(s);
        return { schools_rating: 6 };
      },
    };
    const router = new ProviderRouter([recorder]);
    await warmZip({ companyId: "c1" }, "94110", "CA", "San Francisco", {
      router,
      persist: false,
    });
    expect(seen[0].zip).toBe("94110");
    expect(seen[0].state).toBe("CA");
    expect(seen[0].city).toBe("San Francisco");
  });

  it("returns ok=true with empty signals when every provider returns nothing", async () => {
    const router = new ProviderRouter([fakeProvider("empty", {})]);
    const result = await warmZip({ companyId: "c1" }, "78701", "TX", null, {
      router,
      persist: false,
    });
    expect(result.ok).toBe(true);
    expect(result.signals).toEqual({});
  });

  it("does not throw when one provider rejects — others still contribute", async () => {
    const flaky: CompDataProvider = {
      name: "flaky",
      resolveSubject: async () => null,
      pullComps: async () => [],
      pullMarketSignals: vi.fn(async () => {
        throw new Error("upstream timeout");
      }),
    };
    const router = new ProviderRouter([flaky, fakeProvider("ok", { schools_rating: 5 })]);
    const result = await warmZip({ companyId: "c1" }, "78701", "TX", null, {
      router,
      persist: false,
    });
    expect(result.ok).toBe(true);
    expect(result.signals.schools_rating).toBe(5);
  });
});
