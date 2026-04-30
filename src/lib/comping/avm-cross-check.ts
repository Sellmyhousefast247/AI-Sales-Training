import type { Confidence } from "./types";

/**
 * Cross-check our derived ARV against external AVMs (RentCast, ATTOM, etc.).
 * Big disagreements are a strong signal of either upstream data bugs or an
 * unusual subject — either way, the engine should be less confident.
 */

export interface AvmEstimate {
  source: string;
  arv: number;
}

export interface AvmCrossCheck {
  /** Largest |external − arv| / arv, rounded to 3 decimals. */
  max_spread_pct: number;
  estimates: AvmEstimate[];
  /** How many tiers to drop the confidence by. */
  confidence_drop: 0 | 1 | 2;
  warning: string | null;
}

const DROP_1_THRESHOLD = 0.15;
const DROP_2_THRESHOLD = 0.25;

export function crossCheckAvms(arv: number, avms: AvmEstimate[]): AvmCrossCheck {
  const valid = avms.filter((a) => a.arv > 0);
  if (arv <= 0 || valid.length === 0) {
    return { max_spread_pct: 0, estimates: valid, confidence_drop: 0, warning: null };
  }

  let maxSpread = 0;
  for (const a of valid) {
    const pct = Math.abs(a.arv - arv) / arv;
    if (pct > maxSpread) maxSpread = pct;
  }

  const drop: 0 | 1 | 2 =
    maxSpread >= DROP_2_THRESHOLD ? 2 : maxSpread >= DROP_1_THRESHOLD ? 1 : 0;

  let warning: string | null = null;
  if (drop > 0) {
    const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
    const list = valid.map((a) => `${a.source} ${fmt(a.arv)}`).join(", ");
    warning = `AVM cross-check: ARV ${fmt(arv)} vs ${list} (max spread ${Math.round(
      maxSpread * 100
    )}%).`;
  }

  return {
    max_spread_pct: Number(maxSpread.toFixed(3)),
    estimates: valid,
    confidence_drop: drop,
    warning,
  };
}

const ORDER: Confidence[] = ["High", "Medium", "Low"];

export function applyConfidenceDrop(current: Confidence, drop: 0 | 1 | 2): Confidence {
  if (drop === 0) return current;
  const idx = ORDER.indexOf(current);
  if (idx < 0) return current;
  return ORDER[Math.min(ORDER.length - 1, idx + drop)];
}
