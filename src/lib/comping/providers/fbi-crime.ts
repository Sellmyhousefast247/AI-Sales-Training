import type { CompRecord, MarketSignals, SubjectProperty } from "../types";
import type {
  CompDataProvider,
  PullCompsOptions,
  SubjectQuery,
} from "./types";

/**
 * FBI Crime Data Explorer (CDE) provider — populates `crime_index` for
 * the subject's state. Data is coarse (state-level) but it's free,
 * authoritative, and nationwide.
 *
 * Docs: https://crime-data-explorer.app.cloud.gov/pages/docs
 * Auth: api.data.gov key, sent as ?API_KEY=
 *
 * The CDE returns rates per 100k for violent + property crime. We
 * normalize against U.S. averages so 50 is the national mean and
 * higher = more dangerous. Cap is [0, 100].
 *
 * U.S. averages (UCR/NIBRS, recent multi-year smoothed):
 *   violent_per_100k  ≈ 380
 *   property_per_100k ≈ 1980
 */

interface FbiCrimeConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Override the U.S. average baseline used for normalization. */
  baseline?: { violent: number; property: number };
}

const DEFAULT_BASE = "https://api.usa.gov/crime/fbi/cde";
const DEFAULT_BASELINE = { violent: 380, property: 1980 };

export class FbiCrimeProvider implements CompDataProvider {
  readonly name = "fbi_crime";
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseline: { violent: number; property: number };

  constructor(private readonly config: FbiCrimeConfig) {
    this.base = config.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.baseline = config.baseline ?? DEFAULT_BASELINE;
  }

  async resolveSubject(_q: SubjectQuery): Promise<SubjectProperty | null> {
    return null;
  }
  async pullComps(_s: SubjectProperty, _o: PullCompsOptions): Promise<CompRecord[]> {
    return [];
  }

  async pullMarketSignals(subject: SubjectProperty): Promise<MarketSignals> {
    if (!subject.state) return {};
    const state = subject.state.toUpperCase();
    const key = encodeURIComponent(this.config.apiKey);

    // Endpoints accept the state abbreviation directly. Years are inclusive
    // — we ask for the last full year so partial-year data doesn't skew.
    const lastYear = new Date().getFullYear() - 1;
    const violentUrl =
      `${this.base}/summarized/state/${state}/violent-crime?from=${lastYear}-01-01&to=${lastYear}-12-31&API_KEY=${key}`;
    const propertyUrl =
      `${this.base}/summarized/state/${state}/property-crime?from=${lastYear}-01-01&to=${lastYear}-12-31&API_KEY=${key}`;

    const [violentJson, propertyJson] = await Promise.all([
      this.get(violentUrl).catch(() => null),
      this.get(propertyUrl).catch(() => null),
    ]);

    const violentRate = pickRate(violentJson);
    const propertyRate = pickRate(propertyJson);
    if (violentRate == null && propertyRate == null) return {};

    const v = violentRate ?? this.baseline.violent;
    const p = propertyRate ?? this.baseline.property;

    // Score: 50 = national average, +50 means double the rate, −50 means none.
    const violentScore = (v / this.baseline.violent) * 50;
    const propertyScore = (p / this.baseline.property) * 50;
    const raw = (violentScore + propertyScore) / 2;
    const index = Math.max(0, Math.min(100, Math.round(raw)));
    return { crime_index: index };
  }

  private async get(url: string): Promise<unknown> {
    const res = await this.fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`FBI CDE ${res.status}: ${await safeBody(res)}`);
    }
    return res.json();
  }
}

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract a rate-per-100k value from a CDE summarized response. The CDE
 * returns slightly different shapes per endpoint version; tolerate both
 * `results[*].rate` and a top-level `rate`.
 */
function pickRate(json: unknown): number | null {
  if (!json) return null;
  const j = json as any;
  const candidates: unknown[] = [];

  if (Array.isArray(j?.results)) {
    for (const r of j.results) candidates.push(r?.rate, r?.rate_per_100k);
  }
  candidates.push(j?.rate, j?.rate_per_100k);

  for (const c of candidates) {
    const n = num(c);
    if (n != null) return n;
  }
  return null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

async function safeBody(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 200); } catch { return ""; }
}
