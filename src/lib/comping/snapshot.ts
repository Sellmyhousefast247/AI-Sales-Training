import type { CompRecord, SubjectProperty } from "./types";

/**
 * Per-analysis snapshots. JSONB-friendly plain objects that capture the
 * exact data fed into analyzeDeal() at the time the analysis ran. Future
 * edits to comp_records or comp_subjects do not change these snapshots,
 * so historical analyses stay accurate.
 */

export interface CompSnapshot {
  source: string;
  source_id: string | null;
  status: "sold" | "active" | "pending";
  price: number;
  list_price: number | null;
  original_list_price: number | null;
  dom_days: number | null;
  close_date: string | null;
  list_date: string | null;
  beds: number;
  baths: number;
  sqft: number;
  lot_sqft: number | null;
  year_built: number | null;
  distance_mi: number;
  condition: "as_is" | "average" | "renovated";
  condition_source: "photos" | "remarks" | "manual" | "provider" | null;
  garage_stalls: number | null;
  is_distressed: boolean;
  property_type: string;
  price_imputed: boolean;
}

export interface SubjectSnapshot {
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  beds: number;
  baths: number;
  sqft: number;
  lot_sqft: number | null;
  year_built: number | null;
  property_type: string;
  garage_stalls: number | null;
}

export function buildCompsSnapshot(comps: CompRecord[]): CompSnapshot[] {
  return comps.map((c) => ({
    source: c.source,
    source_id: c.source_id ?? null,
    status: c.status,
    price: c.price,
    list_price: c.list_price ?? null,
    original_list_price: c.original_list_price ?? null,
    dom_days: c.dom_days ?? null,
    close_date: c.close_date ?? null,
    list_date: c.list_date ?? null,
    beds: c.beds,
    baths: c.baths,
    sqft: c.sqft,
    lot_sqft: c.lot_sqft ?? null,
    year_built: c.year_built ?? null,
    distance_mi: c.distance_mi,
    condition: c.condition,
    condition_source: c.condition_source ?? null,
    garage_stalls: c.garage_stalls ?? null,
    is_distressed: c.is_distressed,
    property_type: c.property_type,
    price_imputed: !!c.price_imputed,
  }));
}

export function buildSubjectSnapshot(subject: SubjectProperty): SubjectSnapshot {
  return {
    address: subject.address,
    city: subject.city ?? null,
    state: subject.state ?? null,
    zip: subject.zip ?? null,
    beds: subject.beds,
    baths: subject.baths,
    sqft: subject.sqft,
    lot_sqft: subject.lot_sqft ?? null,
    year_built: subject.year_built ?? null,
    property_type: subject.property_type,
    garage_stalls: subject.garage_stalls ?? null,
  };
}
