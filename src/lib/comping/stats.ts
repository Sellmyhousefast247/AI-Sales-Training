/**
 * Aggregate stats over a list of analyses. Recomputed from whatever
 * the page already loaded (no extra query) so it always matches the
 * filters the user is looking at.
 *
 * Pure — takes plain rows, returns a plain summary. Renderer decides
 * how to present.
 */

export interface AnalysisListItem {
  arv: number;
  as_is_value: number;
  repair_estimate: number;
  wholesale_mao: number;
  novation_mao: number;
  comps_used: number;
  confidence_score: "Low" | "Medium" | "High";
}

export interface ListStats {
  count: number;
  avg_arv: number;
  avg_as_is: number;
  avg_repairs: number;
  total_wholesale_mao: number;
  total_novation_mao: number;
  median_comps_used: number;
  high_confidence_pct: number;
  low_confidence_pct: number;
}

export function computeListStats(rows: AnalysisListItem[]): ListStats {
  const n = rows.length;
  if (n === 0) {
    return {
      count: 0,
      avg_arv: 0,
      avg_as_is: 0,
      avg_repairs: 0,
      total_wholesale_mao: 0,
      total_novation_mao: 0,
      median_comps_used: 0,
      high_confidence_pct: 0,
      low_confidence_pct: 0,
    };
  }

  let arvSum = 0;
  let asIsSum = 0;
  let repairsSum = 0;
  let wholesaleSum = 0;
  let novationSum = 0;
  const compsCounts: number[] = [];
  let highCount = 0;
  let lowCount = 0;

  for (const r of rows) {
    arvSum += num(r.arv);
    asIsSum += num(r.as_is_value);
    repairsSum += num(r.repair_estimate);
    wholesaleSum += num(r.wholesale_mao);
    novationSum += num(r.novation_mao);
    compsCounts.push(num(r.comps_used));
    if (r.confidence_score === "High") highCount++;
    else if (r.confidence_score === "Low") lowCount++;
  }

  return {
    count: n,
    avg_arv: Math.round(arvSum / n),
    avg_as_is: Math.round(asIsSum / n),
    avg_repairs: Math.round(repairsSum / n),
    total_wholesale_mao: Math.round(wholesaleSum),
    total_novation_mao: Math.round(novationSum),
    median_comps_used: median(compsCounts),
    high_confidence_pct: highCount / n,
    low_confidence_pct: lowCount / n,
  };
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
