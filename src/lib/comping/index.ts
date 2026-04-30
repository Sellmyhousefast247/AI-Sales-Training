import {
  buyingPctAdjustment,
  buyingPctFromPending,
  clampBuyingPct,
  marketAdjustedMAO,
  novationMAO,
  wholesaleMAO,
} from "./formulas";
import { estimateRepairs } from "./repair-estimator";
import { runCompPipeline, scoreConfidence } from "./comp-pipeline";
import type { AnalyzeDealInput, AnalyzeDealOutput } from "./types";

export * from "./types";
export * from "./formulas";
export * from "./repair-estimator";
export * from "./comp-pipeline";
export * from "./providers/types";
export { AttomProvider } from "./providers/attom";
export { RentCastProvider } from "./providers/rentcast";
export { BridgeProvider } from "./providers/bridge";
export { GreatSchoolsProvider } from "./providers/greatschools";
export { FbiCrimeProvider } from "./providers/fbi-crime";
export { LotSignalsProvider } from "./providers/lot-signals";
export { warmZip, warmDueQueue, enqueueZip } from "./warmer";
export type { WarmContext, WarmResult } from "./warmer";
export {
  crossCheckAvms,
  applyConfidenceDrop,
  type AvmEstimate,
  type AvmCrossCheck,
} from "./avm-cross-check";
export {
  NON_DISCLOSURE_STATES,
  isNonDisclosureState,
  inferSaleToListRatio,
  imputeSalePrice,
  imputeMissingPrices,
  similarityScore,
  rankBySimilarity,
} from "./non-disclosure";
export { fetchAndAnalyze } from "./orchestrator";
export type {
  FetchAndAnalyzeInput,
  FetchAndAnalyzeResult,
  OrchestratorContext,
} from "./orchestrator";
export { classifyConditions, tagCompConditions } from "./condition-classifier";
export { classifyConditionsFromPhotos, tagCompsByPhotos } from "./photo-classifier";
export { analyzeSubjectPhotos } from "./subject-photo-analyzer";
export type { SubjectPhotoAnalysis } from "./subject-photo-analyzer";
export {
  buildCompsSnapshot,
  buildSubjectSnapshot,
  type CompSnapshot,
  type SubjectSnapshot,
} from "./snapshot";

/**
 * End-to-end deal analysis: ARV + As-Is + Repairs + MAOs + confidence.
 * Pure function — provider fetching is a separate concern.
 */
export function analyzeDeal(input: AnalyzeDealInput): AnalyzeDealOutput {
  const { subject, condition_text, comps, market_signals, wholesale_fee, novation_fee } = input;
  const warnings: string[] = [];

  // 1. ARV — comp solds in renovated condition.
  const arvAgg = runCompPipeline(subject, comps, "renovated");
  if (!arvAgg) warnings.push("Insufficient sold comps for ARV.");

  // 2. As-Is — comp solds in as_is/average condition.
  const asIsAgg = runCompPipeline(subject, comps, "as_is");
  if (!asIsAgg) warnings.push("Insufficient sold comps for As-Is value.");

  // 3. Repairs from condition text.
  const repair = estimateRepairs(subject.sqft, condition_text);

  // 4. Buying % from pending ratio of supplied actives/pendings.
  const actives = comps.filter((c) => c.status === "active").length;
  const pendings = comps.filter((c) => c.status === "pending").length;
  if (actives + pendings === 0) {
    warnings.push("No active or pending comps; using default 70% buying.");
  }
  const baseBuyingPct = buyingPctFromPending(actives, pendings);
  const buyingPct = clampBuyingPct(
    baseBuyingPct + buyingPctAdjustment(market_signals, repair.level)
  );

  // 5. Numbers.
  const arv = arvAgg?.point ?? 0;
  const asIsValue = asIsAgg?.point ?? Math.max(0, Math.round(arv - repair.point));

  const wholesale = wholesaleMAO(arv, repair.point, wholesale_fee);
  const novation = novationMAO(asIsValue, novation_fee);
  const adjusted = marketAdjustedMAO(arv, repair.point, buyingPct, wholesale_fee);

  // 6. Confidence — driven by ARV agg quality + warning count.
  const confidence = scoreConfidence(arvAgg, warnings);

  return {
    arv,
    arv_range: arvAgg?.range ?? { low: 0, high: 0 },
    as_is_value: asIsValue,
    repair_estimate: repair.point,
    repair_breakdown: repair,
    buying_pct: Number(buyingPct.toFixed(3)),
    wholesale_mao: wholesale,
    novation_mao: novation,
    market_adjusted_mao: adjusted,
    confidence_score: confidence,
    comps_used: arvAgg?.comps_used ?? 0,
    warnings,
  };
}
