import type { CompRecord, MarketSignals, SubjectProperty } from "./types";

/**
 * Non-Disclosure States — places where county records do NOT publish the
 * sale price of a closed transaction. In these states ATTOM/county lookups
 * for solds frequently come back with `price` missing or unreliable, while
 * MLS still has the true closing price (when available).
 *
 * When we encounter a "sold" comp from a non-MLS source in one of these
 * states, we impute the likely sale price from list-price history + DOM.
 *
 * Reference: NAR list of non-disclosure states (current as of 2025).
 */
export const NON_DISCLOSURE_STATES = new Set<string>([
  "AK", // partial — many boroughs are NDS
  "ID",
  "KS",
  "LA", // partial / parish-dependent
  "MS",
  "MO",
  "MT",
  "NM",
  "ND",
  "TX",
  "UT",
  "WY",
]);

export function isNonDisclosureState(state?: string | null): boolean {
  if (!state) return false;
  return NON_DISCLOSURE_STATES.has(state.toUpperCase());
}

/**
 * Default sale-to-list ratio by market temperature. Tuned from typical
 * ratios across hot/cool U.S. markets — operators can tune per-market.
 */
const SALE_TO_LIST_BY_RATIO = [
  { pendingRatio: 0.45, slr: 1.02 }, // very hot — bidding wars
  { pendingRatio: 0.35, slr: 1.00 }, // hot — at list
  { pendingRatio: 0.25, slr: 0.98 }, // balanced
  { pendingRatio: 0.15, slr: 0.96 }, // soft
  { pendingRatio: 0.0,  slr: 0.94 }, // rough — concessions + price cuts
];

export function inferSaleToListRatio(activeCount: number, pendingCount: number): number {
  const denom = activeCount + pendingCount;
  if (denom <= 0) return 0.97; // safe default
  const ratio = pendingCount / denom;
  for (const tier of SALE_TO_LIST_BY_RATIO) {
    if (ratio >= tier.pendingRatio) return tier.slr;
  }
  return 0.94;
}

/**
 * Imputes a sale price for a single sold comp that has no `price` but does
 * have `list_price`. Adjustments:
 *   - Apply the market sale-to-list ratio (1.02 hot → 0.94 soft).
 *   - Penalize ½% per 30 days of DOM beyond the first 30 (slow-mover discount).
 *   - Cap the DOM penalty at 6%.
 *   - If `original_list_price` is present and is higher than `list_price`,
 *     we know the seller cut price — anchor on the *current* list_price.
 */
export function imputeSalePrice(
  comp: CompRecord,
  saleToList: number
): number | null {
  const list = comp.list_price ?? comp.original_list_price;
  if (!list) return null;

  let imputed = list * saleToList;

  if (comp.dom_days != null && comp.dom_days > 30) {
    const penaltyMonths = Math.min(12, Math.floor((comp.dom_days - 30) / 30));
    const penalty = Math.min(0.06, penaltyMonths * 0.005);
    imputed *= 1 - penalty;
  }

  return Math.round(imputed);
}

/**
 * Apply price imputation to a batch of comps when the subject is in a
 * non-disclosure state. Non-MLS sold comps with missing prices get filled
 * in from list price + DOM. Comps that already have a real sale price
 * (e.g. from MLS) are left alone.
 */
export function imputeMissingPrices(
  subject: SubjectProperty,
  comps: CompRecord[],
  signals: MarketSignals
): CompRecord[] {
  if (!isNonDisclosureState(subject.state)) return comps;

  const actives = comps.filter((c) => c.status === "active").length;
  const pendings = comps.filter((c) => c.status === "pending").length;
  const slr = inferSaleToListRatio(actives, pendings);

  return comps.map((c) => {
    if (c.status !== "sold") return c;
    if (c.price > 0 && c.source === "bridge") return c; // MLS price is authoritative
    if (c.price > 0 && c.list_price == null) return c;
    const imputed = imputeSalePrice(c, slr);
    if (imputed == null) return c;
    if (c.price > 0 && Math.abs(imputed - c.price) / c.price < 0.05) return c;
    return { ...c, price: imputed, price_imputed: true };
  });

  // Note: `signals` is reserved for future use (e.g. appreciation_12mo
  // adjusting the SLR upward in fast-appreciating markets).
}

/**
 * Score how similar a comp is to the subject. Used to pick the "most
 * similar" properties when we have to lean on imputed prices — those comps
 * carry more weight because their list price is closer to subject value.
 *
 * Score is in [0, 1]; higher = more similar.
 */
export function similarityScore(subject: SubjectProperty, comp: CompRecord): number {
  let score = 1.0;

  // Sqft — most important. ±20% drives this from 1.0 down to ~0.6.
  const sqftDelta = Math.abs(comp.sqft - subject.sqft) / subject.sqft;
  score -= Math.min(0.4, sqftDelta * 2);

  // Beds — each off-by-one costs 8%.
  score -= Math.min(0.16, Math.abs(comp.beds - subject.beds) * 0.08);

  // Baths — each off-by-one costs 6%.
  score -= Math.min(0.12, Math.abs(comp.baths - subject.baths) * 0.06);

  // Year built — each 10y costs 3%.
  if (subject.year_built && comp.year_built) {
    const yearDelta = Math.abs(comp.year_built - subject.year_built);
    score -= Math.min(0.15, (yearDelta / 10) * 0.03);
  }

  // Distance — each 0.25mi costs 4%.
  score -= Math.min(0.20, (comp.distance_mi / 0.25) * 0.04);

  // Property type mismatch is severe.
  if (comp.property_type !== subject.property_type) score -= 0.30;

  return Math.max(0, Math.min(1, score));
}

/**
 * Pick the top-N most similar comps. Used inside the pipeline when we want
 * to lean on the closest matches (e.g. when imputed prices are involved
 * and confidence depends on tight similarity).
 */
export function rankBySimilarity(
  subject: SubjectProperty,
  comps: CompRecord[],
  topN?: number
): CompRecord[] {
  const scored = comps.map((c) => ({ c, s: similarityScore(subject, c) }));
  scored.sort((a, b) => b.s - a.s);
  const out = scored.map((x) => x.c);
  return topN ? out.slice(0, topN) : out;
}
