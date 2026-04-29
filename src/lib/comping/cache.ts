import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  buildCompsSnapshot,
  buildSubjectSnapshot,
  type CompSnapshot,
  type SubjectSnapshot,
} from "./snapshot";
import type {
  AnalyzeDealOutput,
  CompRecord,
  MarketSignals,
  SubjectProperty,
} from "./types";

/**
 * Read-through cache backed by Supabase. Provider results are persisted so
 * subsequent lookups for the same address are instant and don't burn API
 * credits. All writes use the service-role client; we always pass company_id
 * explicitly to keep tenant isolation correct.
 *
 * TTLs are intentionally generous: market data doesn't move fast enough to
 * justify paying for fresh fetches every request.
 */

const SUBJECT_TTL_HOURS = 24 * 7;     // 7 days
const COMPS_TTL_HOURS = 24;           // 1 day
const SIGNALS_TTL_HOURS = 24 * 30;    // 30 days

interface CacheCtx {
  companyId: string;
}

export interface CachedSubject {
  id: string;
  subject: SubjectProperty;
  fetched_at: string;
}

export async function getCachedSubject(
  ctx: CacheCtx,
  address: string
): Promise<CachedSubject | null> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("comp_subjects")
    .select("*")
    .eq("company_id", ctx.companyId)
    .eq("address", address)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  if (isStale(data.fetched_at, SUBJECT_TTL_HOURS)) return null;
  return { id: data.id, subject: rowToSubject(data), fetched_at: data.fetched_at };
}

export async function upsertSubject(
  ctx: CacheCtx,
  subject: SubjectProperty,
  source: string
): Promise<string> {
  const db = createSupabaseAdminClient();
  const row = {
    company_id: ctx.companyId,
    address: subject.address,
    city: subject.city,
    state: subject.state,
    zip: subject.zip,
    lat: subject.lat,
    lng: subject.lng,
    beds: subject.beds,
    baths: subject.baths,
    sqft: subject.sqft,
    lot_sqft: subject.lot_sqft,
    year_built: subject.year_built,
    property_type: subject.property_type,
    garage_stalls: subject.garage_stalls,
    source,
    fetched_at: new Date().toISOString(),
  };
  const { data, error } = await db
    .from("comp_subjects")
    .insert(row)
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function getCachedComps(
  ctx: CacheCtx,
  subjectId: string
): Promise<CompRecord[] | null> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("comp_records")
    .select("*")
    .eq("company_id", ctx.companyId)
    .eq("subject_id", subjectId)
    .eq("excluded", false);
  const rows = (data ?? []) as Array<{ fetched_at: string } & Record<string, unknown>>;
  if (rows.length === 0) return null;
  let newest = rows[0].fetched_at;
  for (const r of rows) if (r.fetched_at > newest) newest = r.fetched_at;
  if (isStale(newest, COMPS_TTL_HOURS)) return null;
  return rows.map(rowToComp);
}

/** All comps for a subject, including excluded ones — for the editor UI. */
export async function getAllCompsForSubject(
  ctx: CacheCtx,
  subjectId: string
): Promise<Array<CompRecord & { id: string; excluded: boolean; notes: string | null }>> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("comp_records")
    .select("*")
    .eq("company_id", ctx.companyId)
    .eq("subject_id", subjectId)
    .order("status", { ascending: true })
    .order("distance_mi", { ascending: true });
  const rows = (data ?? []) as Array<Record<string, unknown> & { id: string; excluded: boolean; notes: string | null }>;
  return rows.map((r) => ({
    ...rowToComp(r),
    id: r.id,
    excluded: r.excluded ?? false,
    notes: (r.notes as string | null) ?? null,
  }));
}

export async function saveComps(
  ctx: CacheCtx,
  subjectId: string,
  comps: CompRecord[]
): Promise<void> {
  if (comps.length === 0) return;
  const db = createSupabaseAdminClient();
  const rows = comps.map((c) => ({
    company_id: ctx.companyId,
    subject_id: subjectId,
    status: c.status,
    price: c.price,
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
    source: c.source,
    source_id: c.source_id ?? null,
    list_price: c.list_price ?? null,
    original_list_price: c.original_list_price ?? null,
    dom_days: c.dom_days ?? null,
    remarks: c.remarks ?? null,
    photo_urls: c.photo_urls ?? null,
    fetched_at: new Date().toISOString(),
  }));
  const { error } = await db
    .from("comp_records")
    .upsert(rows, { onConflict: "source,source_id", ignoreDuplicates: false });
  if (error) throw error;
}

export async function getCachedMarketSignals(
  ctx: CacheCtx,
  subjectId: string
): Promise<MarketSignals | null> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("comp_market_signals")
    .select("*")
    .eq("company_id", ctx.companyId)
    .eq("subject_id", subjectId)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  if (isStale(data.fetched_at, SIGNALS_TTL_HOURS)) return null;
  return rowToSignals(data);
}

export async function saveMarketSignals(
  ctx: CacheCtx,
  subjectId: string,
  signals: MarketSignals
): Promise<void> {
  const db = createSupabaseAdminClient();
  const { error } = await db.from("comp_market_signals").insert({
    company_id: ctx.companyId,
    subject_id: subjectId,
    schools_rating: signals.schools_rating ?? null,
    crime_index: signals.crime_index ?? null,
    appreciation_12mo: signals.appreciation_12mo ?? null,
    is_tourism: signals.is_tourism ?? null,
    is_rural: signals.is_rural ?? null,
    has_lot_defects: signals.has_lot_defects ?? null,
    near_train_or_busy_road: signals.near_train_or_busy_road ?? null,
    curb_appeal: signals.curb_appeal ?? null,
    fetched_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export interface SaveAnalysisOptions {
  /** Comps fed into analyzeDeal — captured immutably on the row. */
  comps?: CompRecord[];
  /** Subject fed into analyzeDeal — captured immutably on the row. */
  subject?: SubjectProperty;
}

export async function saveAnalysis(
  ctx: CacheCtx,
  subjectId: string | null,
  createdBy: string | null,
  output: AnalyzeDealOutput,
  opts: SaveAnalysisOptions = {}
): Promise<string> {
  const db = createSupabaseAdminClient();
  const compsSnapshot: CompSnapshot[] | null = opts.comps
    ? buildCompsSnapshot(opts.comps)
    : null;
  const subjectSnapshot: SubjectSnapshot | null = opts.subject
    ? buildSubjectSnapshot(opts.subject)
    : null;

  const { data, error } = await db
    .from("deal_analyses")
    .insert({
      company_id: ctx.companyId,
      subject_id: subjectId,
      created_by: createdBy,
      arv: output.arv,
      arv_low: output.arv_range.low,
      arv_high: output.arv_range.high,
      as_is_value: output.as_is_value,
      repair_estimate: output.repair_estimate,
      repair_level: output.repair_breakdown.level,
      buying_pct: output.buying_pct,
      wholesale_mao: output.wholesale_mao,
      novation_mao: output.novation_mao,
      market_adjusted_mao: output.market_adjusted_mao,
      confidence_score: output.confidence_score,
      comps_used: output.comps_used,
      warnings: output.warnings,
      payload: output,
      comps_snapshot: compsSnapshot,
      subject_snapshot: subjectSnapshot,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

// helpers ---------------------------------------------------------------

function isStale(fetchedAtIso: string, hours: number): boolean {
  const ageMs = Date.now() - new Date(fetchedAtIso).getTime();
  return ageMs > hours * 60 * 60 * 1000;
}

function rowToSubject(r: any): SubjectProperty {
  return {
    address: r.address,
    city: r.city ?? undefined,
    state: r.state ?? undefined,
    zip: r.zip ?? undefined,
    lat: r.lat ?? undefined,
    lng: r.lng ?? undefined,
    beds: r.beds,
    baths: Number(r.baths),
    sqft: r.sqft,
    lot_sqft: r.lot_sqft ?? undefined,
    year_built: r.year_built ?? undefined,
    property_type: r.property_type,
    garage_stalls: r.garage_stalls ?? undefined,
  };
}

function rowToComp(r: any): CompRecord {
  return {
    source: r.source,
    source_id: r.source_id ?? undefined,
    status: r.status,
    price: Number(r.price),
    list_price: r.list_price == null ? undefined : Number(r.list_price),
    original_list_price:
      r.original_list_price == null ? undefined : Number(r.original_list_price),
    dom_days: r.dom_days == null ? undefined : Number(r.dom_days),
    close_date: r.close_date ?? undefined,
    list_date: r.list_date ?? undefined,
    beds: r.beds,
    baths: Number(r.baths),
    sqft: r.sqft,
    lot_sqft: r.lot_sqft ?? undefined,
    year_built: r.year_built ?? undefined,
    distance_mi: Number(r.distance_mi),
    condition: r.condition,
    condition_source: r.condition_source ?? undefined,
    garage_stalls: r.garage_stalls ?? undefined,
    is_distressed: r.is_distressed,
    property_type: r.property_type,
    remarks: r.remarks ?? undefined,
    photo_urls: Array.isArray(r.photo_urls) ? (r.photo_urls as string[]) : undefined,
  };
}

function rowToSignals(r: any): MarketSignals {
  return {
    schools_rating: r.schools_rating ?? undefined,
    crime_index: r.crime_index ?? undefined,
    appreciation_12mo: r.appreciation_12mo ?? undefined,
    is_tourism: r.is_tourism ?? undefined,
    is_rural: r.is_rural ?? undefined,
    has_lot_defects: r.has_lot_defects ?? undefined,
    near_train_or_busy_road: r.near_train_or_busy_road ?? undefined,
    curb_appeal: r.curb_appeal ?? undefined,
  };
}
