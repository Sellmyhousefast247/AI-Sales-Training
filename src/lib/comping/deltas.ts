/**
 * Compute trend deltas between two consecutive analyses for the same
 * subject. Used by the detail page to show "what changed" after a
 * recompute (ARV moved, repairs went up, MAO shifted, etc.).
 *
 * Pure — takes plain rows, returns a plain record. Renderer decides
 * how to present.
 */

export interface AnalysisNumbers {
  arv: number;
  as_is_value: number;
  repair_estimate: number;
  buying_pct: number;
  wholesale_mao: number;
  novation_mao: number;
  market_adjusted_mao: number;
}

export interface NumberDelta {
  /** current − prev (raw units). */
  diff: number;
  /** (current − prev) / prev. 0 when prev is 0 or non-finite. */
  pct: number;
}

export type DeltaKey = keyof AnalysisNumbers;

export type AnalysisDeltas = Partial<Record<DeltaKey, NumberDelta>>;

const TRACKED_KEYS: DeltaKey[] = [
  "arv",
  "as_is_value",
  "repair_estimate",
  "buying_pct",
  "wholesale_mao",
  "novation_mao",
  "market_adjusted_mao",
];

export function computeDeltas(
  current: AnalysisNumbers,
  prev: AnalysisNumbers | null | undefined
): AnalysisDeltas {
  if (!prev) return {};
  const out: AnalysisDeltas = {};
  for (const k of TRACKED_KEYS) {
    const c = Number(current[k]);
    const p = Number(prev[k]);
    if (!Number.isFinite(c) || !Number.isFinite(p)) continue;
    const diff = c - p;
    if (diff === 0) continue;
    const pct = p === 0 ? 0 : diff / p;
    out[k] = { diff, pct };
  }
  return out;
}

/**
 * Decide whether a higher value is "good" for this metric. The renderer
 * uses this to color-up a green/red arrow.
 *   - ARV / As-Is / MAOs / buying_pct ↑ = good for the buyer/wholesaler.
 *   - Repair estimate ↑ = bad.
 */
export function deltaIsImprovement(key: DeltaKey, diff: number): boolean | null {
  if (diff === 0) return null;
  if (key === "repair_estimate") return diff < 0;
  return diff > 0;
}
