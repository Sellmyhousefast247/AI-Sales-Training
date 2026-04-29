import { z } from "zod";

export const propertyTypeSchema = z.enum([
  "single_family",
  "townhouse",
  "condo",
  "multi_family",
  "manufactured",
  "land",
]);
export type PropertyType = z.infer<typeof propertyTypeSchema>;

export const subjectPropertySchema = z.object({
  address: z.string().min(1),
  city: z.string().optional(),
  state: z.string().length(2).optional(),
  zip: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  beds: z.number().int().nonnegative(),
  baths: z.number().nonnegative(),
  sqft: z.number().int().positive(),
  lot_sqft: z.number().int().positive().optional(),
  year_built: z.number().int().min(1800).max(2100).optional(),
  property_type: propertyTypeSchema.default("single_family"),
  garage_stalls: z.number().int().nonnegative().optional(),
});
export type SubjectProperty = z.infer<typeof subjectPropertySchema>;

export const compConditionSchema = z.enum(["as_is", "average", "renovated"]);
export type CompCondition = z.infer<typeof compConditionSchema>;

export const compStatusSchema = z.enum(["sold", "active", "pending"]);
export type CompStatus = z.infer<typeof compStatusSchema>;

export const compRecordSchema = z.object({
  source: z.string(),
  source_id: z.string().optional(),
  status: compStatusSchema,
  price: z.number().nonnegative(),
  list_price: z.number().positive().optional(),
  original_list_price: z.number().positive().optional(),
  dom_days: z.number().int().nonnegative().optional(),
  close_date: z.string().optional(), // ISO date for solds
  list_date: z.string().optional(),
  beds: z.number().int().nonnegative(),
  baths: z.number().nonnegative(),
  sqft: z.number().int().positive(),
  lot_sqft: z.number().int().positive().optional(),
  year_built: z.number().int().optional(),
  distance_mi: z.number().nonnegative(),
  condition: compConditionSchema.default("average"),
  garage_stalls: z.number().int().nonnegative().optional(),
  is_distressed: z.boolean().default(false),
  property_type: propertyTypeSchema.default("single_family"),
  remarks: z.string().optional(),
  /** True when sale price was imputed from list price (non-disclosure states). */
  price_imputed: z.boolean().optional(),
});
export type CompRecord = z.infer<typeof compRecordSchema>;

export const marketSignalsSchema = z.object({
  schools_rating: z.number().min(1).max(10).optional(),
  crime_index: z.number().min(0).max(100).optional(), // higher = worse
  appreciation_12mo: z.number().optional(), // e.g. 0.05 = +5%
  is_tourism: z.boolean().optional(),
  is_rural: z.boolean().optional(),
  has_lot_defects: z.boolean().optional(),
  near_train_or_busy_road: z.boolean().optional(),
  curb_appeal: z.enum(["poor", "average", "good"]).optional(),
});
export type MarketSignals = z.infer<typeof marketSignalsSchema>;

export const analyzeDealInputSchema = z.object({
  subject: subjectPropertySchema,
  condition_text: z.string().default(""),
  comps: z.array(compRecordSchema).default([]),
  market_signals: marketSignalsSchema.default({}),
  wholesale_fee: z.number().nonnegative().default(20_000),
  novation_fee: z.number().nonnegative().default(40_000),
});
export type AnalyzeDealInput = z.infer<typeof analyzeDealInputSchema>;

export const repairLevelSchema = z.enum(["Light", "Moderate", "Heavy", "Full Gut"]);
export type RepairLevel = z.infer<typeof repairLevelSchema>;

export const confidenceSchema = z.enum(["Low", "Medium", "High"]);
export type Confidence = z.infer<typeof confidenceSchema>;

export interface RepairEstimate {
  level: RepairLevel;
  low: number;
  high: number;
  point: number;
  drivers: string[];
  cost_per_sqft: { low: number; high: number };
}

export interface CompAggregate {
  comps_used: number;
  point: number;
  range: { low: number; high: number };
  median_ppsf: number;
  iqr_pct: number;
  radius_mi: number;
}

export interface AnalyzeDealOutput {
  arv: number;
  arv_range: { low: number; high: number };
  as_is_value: number;
  repair_estimate: number;
  repair_breakdown: RepairEstimate;
  buying_pct: number;
  wholesale_mao: number;
  novation_mao: number;
  market_adjusted_mao: number;
  confidence_score: Confidence;
  comps_used: number;
  warnings: string[];
}
