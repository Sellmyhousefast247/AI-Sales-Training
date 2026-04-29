import type { CompRecord, MarketSignals, SubjectProperty } from "../types";

/**
 * Every external data source (ATTOM, Bridge MLS, RentCast, ...) implements
 * this interface. The engine fans out across providers and merges the results.
 */
export interface CompDataProvider {
  readonly name: string;

  /** Resolve a subject record from an address — null if not found. */
  resolveSubject(query: SubjectQuery): Promise<SubjectProperty | null>;

  /**
   * Pull comps near a subject. Implementations should return both solds
   * (last 12 months max) and currently active/pending listings.
   */
  pullComps(subject: SubjectProperty, opts: PullCompsOptions): Promise<CompRecord[]>;

  /**
   * Optional — pull qualitative market signals (schools, crime, etc.).
   * Providers that don't have this data should return an empty object.
   */
  pullMarketSignals?(subject: SubjectProperty): Promise<MarketSignals>;
}

export interface SubjectQuery {
  address: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface PullCompsOptions {
  /** Initial radius in miles — provider may return a wider set. */
  radiusMi: number;
  /** How far back to pull solds. */
  monthsBack: number;
  /** Hard limit so we don't blow API budgets. */
  limit?: number;
}

/**
 * Multi-provider aggregator. Calls every provider in parallel and merges
 * their comps, deduping on (source, source_id) and on (address, close_date).
 */
export class ProviderRouter {
  constructor(private providers: CompDataProvider[]) {}

  async resolveSubject(query: SubjectQuery): Promise<SubjectProperty | null> {
    for (const p of this.providers) {
      try {
        const hit = await p.resolveSubject(query);
        if (hit) return hit;
      } catch {
        // try next provider
      }
    }
    return null;
  }

  async pullComps(subject: SubjectProperty, opts: PullCompsOptions): Promise<CompRecord[]> {
    const results = await Promise.allSettled(
      this.providers.map((p) => p.pullComps(subject, opts))
    );
    const merged: CompRecord[] = [];
    const seen = new Set<string>();
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const c of r.value) {
        const key = `${c.source}::${c.source_id ?? `${c.price}|${c.close_date ?? ""}|${c.sqft}`}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(c);
      }
    }
    return merged;
  }

  async pullMarketSignals(subject: SubjectProperty): Promise<MarketSignals> {
    const out: MarketSignals = {};
    for (const p of this.providers) {
      if (!p.pullMarketSignals) continue;
      try {
        Object.assign(out, await p.pullMarketSignals(subject));
      } catch {
        // ignore
      }
    }
    return out;
  }
}
