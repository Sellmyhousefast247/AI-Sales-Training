import type { CompRecord, MarketSignals, SubjectProperty } from "../types";
import type {
  CompDataProvider,
  PullCompsOptions,
  SubjectQuery,
} from "./types";

/**
 * GreatSchools provider — populates `schools_rating` (1–10) for the
 * subject by averaging the nearest few public schools.
 *
 * Docs: https://www.greatschools.org/api/ (Pro tier required for
 * commercial use). Field names follow the Pro v1 shape but we parse
 * defensively so older / community feeds work too.
 *
 * This is a *signals-only* provider — resolveSubject and pullComps are
 * stubbed. ProviderRouter merges its `pullMarketSignals` output with
 * everything else.
 */

interface GreatSchoolsConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Search radius in miles. Default 2. */
  radiusMi?: number;
  /** Max schools to average across. Default 5. */
  maxSchools?: number;
}

const DEFAULT_BASE = "https://gs-api.greatschools.org";

export class GreatSchoolsProvider implements CompDataProvider {
  readonly name = "greatschools";
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly radiusMi: number;
  private readonly maxSchools: number;

  constructor(private readonly config: GreatSchoolsConfig) {
    this.base = config.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.radiusMi = config.radiusMi ?? 2;
    this.maxSchools = config.maxSchools ?? 5;
  }

  // Signals-only provider — these intentionally no-op.
  async resolveSubject(_q: SubjectQuery): Promise<SubjectProperty | null> {
    return null;
  }
  async pullComps(_s: SubjectProperty, _o: PullCompsOptions): Promise<CompRecord[]> {
    return [];
  }

  async pullMarketSignals(subject: SubjectProperty): Promise<MarketSignals> {
    if (subject.lat == null || subject.lng == null) return {};

    const url =
      `${this.base}/schools/nearby` +
      `?lat=${subject.lat}&lon=${subject.lng}` +
      `&radius=${this.radiusMi}&limit=${this.maxSchools}` +
      `&apiKey=${encodeURIComponent(this.config.apiKey)}`;

    const json = await this.get(url).catch(() => null);
    if (!json) return {};

    const schools = pickSchools(json);
    const rating = aggregateRating(schools);
    return rating != null ? { schools_rating: rating } : {};
  }

  private async get(url: string): Promise<unknown> {
    const res = await this.fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`GreatSchools ${res.status}: ${await safeBody(res)}`);
    }
    return res.json();
  }
}

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

function pickSchools(json: unknown): Array<{ rating: number; type?: string }> {
  // Tolerate { schools: [...] }, { data: [...] }, or a top-level array.
  const raw =
    Array.isArray(json) ? json :
    Array.isArray((json as any)?.schools) ? (json as any).schools :
    Array.isArray((json as any)?.data) ? (json as any).data :
    [];
  return raw
    .map((s: any) => {
      const rating = num(s?.gsRating ?? s?.rating ?? s?.gs_rating);
      if (rating == null) return null;
      return { rating, type: typeof s?.type === "string" ? s.type : undefined };
    })
    .filter(Boolean) as Array<{ rating: number; type?: string }>;
}

/**
 * Average rating across the nearest schools. When school types are
 * present, weight elementary/middle/high equally so a single bad
 * elementary school doesn't dominate the picture in an area where
 * the relevant high school is great.
 */
function aggregateRating(schools: Array<{ rating: number; type?: string }>): number | null {
  if (schools.length === 0) return null;

  const buckets: Record<string, number[]> = {};
  for (const s of schools) {
    const key = (s.type ?? "all").toLowerCase();
    (buckets[key] ??= []).push(s.rating);
  }
  // If we have type-grouped data, average each bucket then average across buckets.
  const keys = Object.keys(buckets).filter((k) => k !== "all");
  const list = keys.length > 0
    ? keys.map((k) => avg(buckets[k]))
    : (buckets["all"] ?? []);
  if (list.length === 0) return null;
  const result = avg(list);
  return Math.round(result * 10) / 10;
}

function avg(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

async function safeBody(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 200); } catch { return ""; }
}
