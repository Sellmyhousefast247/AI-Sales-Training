import type {
  CompAggregate,
  CompCondition,
  CompRecord,
  Confidence,
  SubjectProperty,
} from "./types";

interface FilterOptions {
  radiusMi: number;
  bedsTolerance: number;
  bathsTolerance: number;
  sqftPct: number;
  yearTolerance: number;
  monthsBack: number;
}

const DEFAULT_FILTERS: FilterOptions = {
  radiusMi: 0.25,
  bedsTolerance: 1,
  bathsTolerance: 1,
  sqftPct: 0.2,
  yearTolerance: 15,
  monthsBack: 6,
};

const RADIUS_LADDER = [0.25, 0.5, 1.0];
const MONTHS_LADDER = [6, 9, 12];

export function filterComps(
  subject: SubjectProperty,
  comps: CompRecord[],
  opts: Partial<FilterOptions> = {}
): CompRecord[] {
  const o = { ...DEFAULT_FILTERS, ...opts };
  const cutoff = monthsAgo(o.monthsBack);

  return comps.filter((c) => {
    if (c.is_distressed) return false;
    if (c.property_type !== subject.property_type) return false;
    if (c.distance_mi > o.radiusMi) return false;
    if (Math.abs(c.beds - subject.beds) > o.bedsTolerance) return false;
    if (Math.abs(c.baths - subject.baths) > o.bathsTolerance) return false;
    if (Math.abs(c.sqft - subject.sqft) / subject.sqft > o.sqftPct) return false;
    if (
      subject.year_built &&
      c.year_built &&
      Math.abs(c.year_built - subject.year_built) > o.yearTolerance
    ) {
      return false;
    }
    if (c.status === "sold" && c.close_date && new Date(c.close_date) < cutoff) {
      return false;
    }
    return true;
  });
}

/**
 * Expand search by radius then by months until we have at least `min` comps.
 * Returns the surviving comps and the radius/months that were ultimately used.
 */
export function expandUntilEnough(
  subject: SubjectProperty,
  comps: CompRecord[],
  status: "sold" | "active" = "sold",
  min = 3
): { comps: CompRecord[]; radius: number; months: number } {
  const pool = comps.filter((c) => c.status === status);

  for (const months of MONTHS_LADDER) {
    for (const radius of RADIUS_LADDER) {
      const filtered = filterComps(subject, pool, { radiusMi: radius, monthsBack: months });
      if (filtered.length >= min) {
        return { comps: filtered, radius, months };
      }
    }
  }
  // Last resort — widest filter even if under min.
  const last = filterComps(subject, pool, { radiusMi: 1.0, monthsBack: 12 });
  return { comps: last, radius: 1.0, months: 12 };
}

/**
 * Drop $/sqft outliers by IQR (Tukey 1.5×).
 */
export function removeOutliers(comps: CompRecord[]): CompRecord[] {
  if (comps.length < 4) return comps;
  const ppsf = comps.map((c) => c.price / c.sqft).sort((a, b) => a - b);
  const q1 = quantile(ppsf, 0.25);
  const q3 = quantile(ppsf, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  return comps.filter((c) => {
    const p = c.price / c.sqft;
    return p >= lo && p <= hi;
  });
}

/**
 * Adjust each comp's $/sqft for differences vs. the subject. Returns adjusted
 * total prices (not $/sqft).
 */
export function adjustComps(subject: SubjectProperty, comps: CompRecord[]): number[] {
  return comps.map((c) => {
    const ppsf = c.price / c.sqft;
    let adjustedPpsf = ppsf;

    // Lot size — small per-sqft adjustment beyond ±10% delta.
    if (subject.lot_sqft && c.lot_sqft) {
      const lotDelta = subject.lot_sqft - c.lot_sqft;
      const tolerance = 0.1 * c.lot_sqft;
      if (Math.abs(lotDelta) > tolerance) {
        const beyond = lotDelta - Math.sign(lotDelta) * tolerance;
        adjustedPpsf += (beyond * 1.0) / subject.sqft; // ~$1/lot-sqft
      }
    }

    // Garage — flat $5k/stall delta.
    if (subject.garage_stalls != null && c.garage_stalls != null) {
      const stallDelta = subject.garage_stalls - c.garage_stalls;
      adjustedPpsf += (stallDelta * 5_000) / subject.sqft;
    }

    return Math.max(0, adjustedPpsf * subject.sqft);
  });
}

/**
 * Aggregate adjusted prices into a single value using the trimmed mean and a
 * ±1 stdev range.
 */
export function aggregate(adjusted: number[], radiusMi: number): CompAggregate | null {
  if (adjusted.length === 0) return null;
  const sorted = [...adjusted].sort((a, b) => a - b);
  const trim = sorted.length >= 6 ? 1 : 0;
  const trimmed = sorted.slice(trim, sorted.length - trim);
  const mean = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
  const variance = trimmed.reduce((s, v) => s + (v - mean) ** 2, 0) / trimmed.length;
  const sd = Math.sqrt(variance);
  const median = quantile(sorted, 0.5);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqrPct = median > 0 ? (q3 - q1) / median : 0;

  return {
    comps_used: adjusted.length,
    point: Math.round(mean),
    range: { low: Math.round(mean - sd), high: Math.round(mean + sd) },
    median_ppsf: Math.round(median),
    iqr_pct: Number(iqrPct.toFixed(3)),
    radius_mi: radiusMi,
  };
}

/**
 * Run the full pipeline for one condition target ("renovated" → ARV,
 * "as_is" → As-Is). Returns null when there isn't enough data.
 */
export function runCompPipeline(
  subject: SubjectProperty,
  allComps: CompRecord[],
  target: CompCondition
): CompAggregate | null {
  const expanded = expandUntilEnough(subject, allComps, "sold", 3);
  const targeted = expanded.comps.filter((c) => matchesCondition(c.condition, target));
  // We deliberately do NOT fall back to non-matching conditions — mixing
  // renovated and as_is comps would distort both ARV and As-Is. The caller
  // (analyzeDeal) handles the null case via ARV − repairs.
  if (targeted.length < 3) return null;
  const cleaned = removeOutliers(targeted);
  if (cleaned.length === 0) return null;
  const adjusted = adjustComps(subject, cleaned);
  return aggregate(adjusted, expanded.radius);
}

export function scoreConfidence(agg: CompAggregate | null, warnings: string[]): Confidence {
  if (!agg || agg.comps_used < 3) return "Low";
  if (agg.iqr_pct > 0.25 || agg.radius_mi > 1.0) return "Low";
  if (warnings.length >= 2) return "Low";
  if (agg.comps_used >= 5 && agg.radius_mi <= 0.5 && agg.iqr_pct < 0.15 && warnings.length === 0) {
    return "High";
  }
  return "Medium";
}

// helpers ---------------------------------------------------------------

function matchesCondition(c: CompCondition, target: CompCondition): boolean {
  if (target === "renovated") return c === "renovated";
  if (target === "as_is") return c === "as_is" || c === "average";
  return true;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function monthsAgo(n: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}
