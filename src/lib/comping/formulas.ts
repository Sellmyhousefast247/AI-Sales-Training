import type { MarketSignals, RepairLevel } from "./types";

export const DEFAULT_BUYING_PCT = 0.7;
export const DEFAULT_WHOLESALE_FEE = 20_000;
export const DEFAULT_NOVATION_FEE = 40_000;
export const NOVATION_SALE_DISCOUNT = 0.9;

export function wholesaleMAO(arv: number, repairs: number, fee = DEFAULT_WHOLESALE_FEE): number {
  return Math.round(arv * DEFAULT_BUYING_PCT - repairs - fee);
}

export function novationMAO(asIsValue: number, fee = DEFAULT_NOVATION_FEE): number {
  return Math.round(asIsValue * NOVATION_SALE_DISCOUNT - fee);
}

/**
 * Pending-driven novation discount. The base novation offer assumes a
 * normal market (≥30% pending). Below that, we hold back more — there's
 * less buyer competition to bail us out if the listing sits.
 *
 *   ≥30% pending  → 0.90  (default)
 *   15–29%        → 0.85  (conservative)
 *   <15%          → 0.80  (very conservative)
 */
export function novationDiscountFromPending(pendingRatio: number): number {
  if (pendingRatio < 0.15) return 0.80;
  if (pendingRatio < 0.30) return 0.85;
  return NOVATION_SALE_DISCOUNT;
}

export function novationMAOWithPending(
  asIsValue: number,
  pendingRatio: number,
  fee = DEFAULT_NOVATION_FEE
): number {
  const discount = novationDiscountFromPending(pendingRatio);
  return Math.round(asIsValue * discount - fee);
}

export function marketAdjustedMAO(
  arv: number,
  repairs: number,
  buyingPct: number,
  fee = DEFAULT_WHOLESALE_FEE
): number {
  return Math.round(arv * buyingPct - repairs - fee);
}

/**
 * Pending ratio = pendings / (actives + pendings). Returns the base buying %
 * per the playbook tiers.
 */
export function buyingPctFromPending(activeCount: number, pendingCount: number): number {
  const denom = activeCount + pendingCount;
  if (denom <= 0) return DEFAULT_BUYING_PCT;
  const ratio = pendingCount / denom;
  if (ratio < 0.15) return 0.66;
  if (ratio < 0.25) return 0.68;
  if (ratio < 0.35) return 0.70;
  if (ratio < 0.45) return 0.73;
  return 0.75;
}

/**
 * Net qualitative adjustment to the base buying %. Capped at -10% (rough
 * market) to +5% (strong market) per the playbook.
 */
export function buyingPctAdjustment(
  signals: MarketSignals,
  repairLevel: RepairLevel
): number {
  let delta = 0;

  if (signals.schools_rating != null) {
    if (signals.schools_rating >= 7) delta += 0.02;
    else if (signals.schools_rating <= 2) delta -= 0.03;
    else if (signals.schools_rating <= 4) delta -= 0.01;
  }

  if (signals.crime_index != null) {
    if (signals.crime_index >= 70) delta -= 0.03;
    else if (signals.crime_index >= 50) delta -= 0.01;
    else if (signals.crime_index <= 20) delta += 0.01;
  }

  if (signals.appreciation_12mo != null) {
    if (signals.appreciation_12mo >= 0.07) delta += 0.02;
    else if (signals.appreciation_12mo <= -0.02) delta -= 0.02;
  }

  if (signals.has_lot_defects) delta -= 0.02;
  if (signals.near_train_or_busy_road) delta -= 0.02;
  if (signals.is_rural) delta -= 0.02;
  if (signals.is_tourism) delta += 0.01;

  if (signals.curb_appeal === "poor") delta -= 0.02;
  if (signals.curb_appeal === "good") delta += 0.01;

  if (repairLevel === "Heavy") delta -= 0.02;
  if (repairLevel === "Full Gut") delta -= 0.04;

  return Math.max(-0.10, Math.min(0.05, delta));
}

export function clampBuyingPct(pct: number): number {
  return Math.max(0.5, Math.min(0.85, pct));
}
