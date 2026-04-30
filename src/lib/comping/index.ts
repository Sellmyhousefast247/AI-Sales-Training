import {
  buyingPctAdjustment,
  buyingPctFromPending,
  clampBuyingPct,
  marketAdjustedMAO,
  novationMAO,
  wholesaleMAO,
} from "./formulas";
import { compatibleTypes, isStrictPropertyType } from "./property-type";
import { estimateRepairs } from "./repair-estimator";
import {
  MONTHS_LADDER_NOVATION,
  RADIUS_LADDER_NOVATION,
  runCompPipeline,
  scoreConfidence,
  type ExpandLadders,
} from "./comp-pipeline";
import type {
  AnalyzeDealInput,
  AnalyzeDealOutput,
  CompCondition,
  CompRecord,
  PropertyType,
  SubjectProperty,
} from "./types";

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
export {
  detectPropertyType,
  detectPropertyTypeOrDefault,
  isStrictPropertyType,
  compatibleTypes,
} from "./property-type";

/**
 * End-to-end deal analysis: ARV + As-Is + Repairs + MAOs + confidence.
 * Pure function — provider fetching is a separate concern.
 */
export function analyzeDeal(input: AnalyzeDealInput): AnalyzeDealOutput {
  const {
    subject,
    condition_text,
    comps,
    market_signals,
    wholesale_fee,
    novation_fee,
    repair_level,
  } = input;
  const warnings: string[] = [];

  // Property-type aware comping: strict same-type pass first; if too few
  // survive AND the subject type permits a fallback (SF↔townhouse), retry
  // with the compatible types and warn. Strict types (manufactured,
  // multi_family, land) never fall back.
  //
  // ARV (renovated) uses the tighter default ladder (≤12 months, ≤1 mi).
  // As-Is (novation) uses an extended ladder — as-is sales show up less
  // often on the MLS, so we let the search stretch up to 24 months and
  // 2 miles before giving up. Sales > 12 months out / > 1 mi out
  // generate a "stretched" warning so the user knows.
  const arvAgg = runCompPipelineWithFallback(subject, comps, "renovated", warnings, "ARV");
  const asIsAgg = runCompPipelineWithFallback(subject, comps, "as_is", warnings, "As-Is", {
    radius: RADIUS_LADDER_NOVATION,
    months: MONTHS_LADDER_NOVATION,
  });
  if (asIsAgg && (asIsAgg.months_back > 12 || asIsAgg.radius_mi > 1.0)) {
    warnings.push(
      `Novation comps stretched to ${asIsAgg.months_back} months / ${asIsAgg.radius_mi} mi due to limited as-is inventory.`
    );
  }

  // 3. Repairs from condition text.
  const repair = estimateRepairs(subject.sqft, condition_text, repair_level);
  if (repair.override_used && repair.auto_level && repair.auto_level !== repair.level) {
    warnings.push(
      `Repair tier override: notes look like ${repair.auto_level} but ${repair.level} was selected.`
    );
  }

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

/**
 * Strict same-type pipeline first. If it returns null AND the subject
 * type is non-strict (SF / townhouse / condo), retry with compatible
 * types (SF↔townhouse — condo stays alone). Strict types
 * (manufactured / multi_family / land) skip the fallback entirely so
 * we never silently mix incompatible markets.
 */
function runCompPipelineWithFallback(
  subject: SubjectProperty,
  comps: CompRecord[],
  target: CompCondition,
  warnings: string[],
  label: "ARV" | "As-Is",
  ladders?: ExpandLadders
) {
  const strictAllowed: ReadonlySet<PropertyType> = new Set([subject.property_type]);
  const strict = runCompPipeline(subject, comps, target, strictAllowed, ladders);
  if (strict) return strict;

  if (isStrictPropertyType(subject.property_type)) {
    warnings.push(
      `Insufficient sold comps for ${label}. ${prettyType(subject.property_type)} comps are valued differently from other property types — falling back is disabled.`
    );
    return null;
  }

  const compatible = compatibleTypes(subject.property_type);
  if (compatible.length <= 1) {
    warnings.push(`Insufficient sold comps for ${label}.`);
    return null;
  }

  const relaxedAllowed: ReadonlySet<PropertyType> = new Set(compatible);
  const relaxed = runCompPipeline(subject, comps, target, relaxedAllowed, ladders);
  if (relaxed) {
    const others = compatible
      .filter((t) => t !== subject.property_type)
      .map(prettyType)
      .join(", ");
    warnings.push(
      `${label} fell back to compatible property types (${others}) — too few same-type comps available.`
    );
    return relaxed;
  }
  warnings.push(`Insufficient sold comps for ${label}.`);
  return null;
}

function prettyType(t: PropertyType): string {
  return t.replace(/_/g, " ");
}
