import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { AttomProvider } from "./providers/attom";
import { BridgeProvider } from "./providers/bridge";
import { FbiCrimeProvider } from "./providers/fbi-crime";
import { GreatSchoolsProvider } from "./providers/greatschools";
import { LotSignalsProvider } from "./providers/lot-signals";
import { RentCastProvider } from "./providers/rentcast";
import { ProviderRouter, type CompDataProvider } from "./providers/types";
import type { MarketSignals, SubjectProperty } from "./types";

/**
 * Background pre-warm of the comping cache by zip.
 *
 * Strategy: for each (company, zip) row in comp_warm_queue, call every
 * configured provider's `pullMarketSignals` against a synthetic subject
 * pinned to that zip. The result is persisted with `zip` set on
 * `comp_market_signals`, so live `fetchAndAnalyze` runs in the same zip
 * skip the slow third-party calls and return instantly.
 *
 * We don't pre-warm subjects/comps here — those are address-specific
 * and would require speculative API spend. Signals are zip-stable and
 * cheap to refresh on a schedule.
 */

export interface WarmContext {
  companyId: string;
}

export interface WarmResult {
  zip: string;
  state: string | null;
  ok: boolean;
  signals: MarketSignals;
  error?: string;
}

export interface WarmZipOptions {
  /** Inject a router for testing. Defaults to one built from env keys. */
  router?: ProviderRouter | null;
  /** Skip the comp_market_signals insert (testing). */
  persist?: boolean;
}

/**
 * Warm a single (zip, state). Returns the resolved signals plus an
 * `ok` flag. Persists to comp_market_signals on success.
 */
export async function warmZip(
  ctx: WarmContext,
  zip: string,
  state: string | null,
  city: string | null = null,
  opts: WarmZipOptions = {}
): Promise<WarmResult> {
  const router = opts.router !== undefined ? opts.router : buildSignalsRouter();
  if (!router) {
    return { zip, state, ok: false, signals: {}, error: "No signal providers configured" };
  }

  const subject: SubjectProperty = {
    address: `Zip ${zip}`,
    state: state ?? undefined,
    city: city ?? undefined,
    zip,
    beds: 3,
    baths: 2,
    sqft: 1500,
    property_type: "single_family",
  };

  let signals: MarketSignals;
  try {
    signals = await router.pullMarketSignals(subject);
  } catch (err) {
    return { zip, state, ok: false, signals: {}, error: (err as Error).message };
  }
  if (Object.keys(signals).length === 0) {
    return { zip, state, ok: true, signals };
  }

  if (opts.persist === false) {
    return { zip, state, ok: true, signals };
  }
  const db = createSupabaseAdminClient();
  const { error } = await db.from("comp_market_signals").insert({
    company_id: ctx.companyId,
    subject_id: null,
    zip,
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
  if (error) {
    return { zip, state, ok: false, signals, error: error.message };
  }
  return { zip, state, ok: true, signals };
}

interface QueueRow {
  id: string;
  company_id: string;
  zip: string;
  state: string | null;
  city: string | null;
  last_warmed_at: string | null;
  priority: number;
}

/**
 * Take the next N due queue rows across all companies, warm each one,
 * and stamp the result. Returns per-row outcomes for the cron job to log.
 */
export async function warmDueQueue(limit = 25): Promise<Array<WarmResult & { id: string }>> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("comp_warm_queue")
    .select("id, company_id, zip, state, city, last_warmed_at, priority")
    .order("last_warmed_at", { ascending: true, nullsFirst: true })
    .order("priority", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as QueueRow[];

  const results: Array<WarmResult & { id: string }> = [];
  for (const row of rows) {
    const result = await warmZip(
      { companyId: row.company_id },
      row.zip,
      row.state,
      row.city
    );
    await db
      .from("comp_warm_queue")
      .update({
        last_warmed_at: new Date().toISOString(),
        last_error: result.ok ? null : result.error ?? null,
      })
      .eq("id", row.id);
    results.push({ ...result, id: row.id });
  }
  return results;
}

/**
 * Add or refresh a (company, zip) entry in the queue. Idempotent — if the
 * row already exists, just bumps the priority.
 */
export async function enqueueZip(
  ctx: WarmContext,
  zip: string,
  state: string | null,
  city: string | null = null,
  priority = 0
): Promise<void> {
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("comp_warm_queue")
    .upsert(
      {
        company_id: ctx.companyId,
        zip,
        state,
        city,
        priority,
        queued_at: new Date().toISOString(),
      },
      { onConflict: "company_id,zip" }
    );
  if (error) throw error;
}

function buildSignalsRouter(): ProviderRouter | null {
  const providers: CompDataProvider[] = [];
  // Comp-data providers can also expose pullMarketSignals (e.g. via
  // ATTOM's neighborhood data); we register all of them so any signal
  // any provider exposes gets cached.
  if (process.env.BRIDGE_ACCESS_TOKEN && process.env.BRIDGE_DATASET) {
    providers.push(
      new BridgeProvider({
        accessToken: process.env.BRIDGE_ACCESS_TOKEN,
        dataset: process.env.BRIDGE_DATASET,
      })
    );
  }
  if (process.env.ATTOM_API_KEY) {
    providers.push(new AttomProvider({ apiKey: process.env.ATTOM_API_KEY }));
  }
  if (process.env.RENTCAST_API_KEY) {
    providers.push(new RentCastProvider({ apiKey: process.env.RENTCAST_API_KEY }));
  }
  if (process.env.GREATSCHOOLS_API_KEY) {
    providers.push(new GreatSchoolsProvider({ apiKey: process.env.GREATSCHOOLS_API_KEY }));
  }
  if (process.env.FBI_CRIME_API_KEY) {
    providers.push(new FbiCrimeProvider({ apiKey: process.env.FBI_CRIME_API_KEY }));
  }
  if (envFlag("LOT_SIGNALS_ENABLED")) {
    providers.push(new LotSignalsProvider());
  }
  return providers.length > 0 ? new ProviderRouter(providers) : null;
}

function envFlag(name: string): boolean {
  const v = process.env[name];
  if (!v) return false;
  const t = v.toLowerCase().trim();
  return t === "1" || t === "true" || t === "yes" || t === "on";
}
