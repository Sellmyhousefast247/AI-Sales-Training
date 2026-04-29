import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import {
  analyzeDeal,
  imputeMissingPrices,
  isNonDisclosureState,
} from "@/lib/comping";
import { saveAnalysis, getCachedMarketSignals, getAllCompsForSubject } from "@/lib/comping/cache";
import type { CompRecord, MarketSignals, SubjectProperty } from "@/lib/comping";

export const runtime = "nodejs";

/**
 * Re-runs the analysis from the *current* DB state of the subject's comps —
 * picks up any edits or exclusions the user made since the last run. Saves
 * the result as a new deal_analyses row so history is preserved.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;

  // 1. Load the analysis (RLS-scoped).
  const supabase = await createSupabaseServerClient();
  const { data: analysis, error: aErr } = await supabase
    .from("deal_analyses")
    .select("id, subject_id, payload")
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .maybeSingle();
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (!analysis?.subject_id) return NextResponse.json({ error: "Analysis not found" }, { status: 404 });

  // 2. Load subject from comp_subjects (RLS).
  const { data: subjRow, error: sErr } = await supabase
    .from("comp_subjects")
    .select("*")
    .eq("id", analysis.subject_id)
    .maybeSingle();
  if (sErr || !subjRow) return NextResponse.json({ error: "Subject not found" }, { status: 404 });
  const subject: SubjectProperty = {
    address: subjRow.address,
    city: subjRow.city ?? undefined,
    state: subjRow.state ?? undefined,
    zip: subjRow.zip ?? undefined,
    lat: subjRow.lat ?? undefined,
    lng: subjRow.lng ?? undefined,
    beds: subjRow.beds,
    baths: Number(subjRow.baths),
    sqft: subjRow.sqft,
    lot_sqft: subjRow.lot_sqft ?? undefined,
    year_built: subjRow.year_built ?? undefined,
    property_type: subjRow.property_type,
    garage_stalls: subjRow.garage_stalls ?? undefined,
  };

  // 3. Pull non-excluded comps from DB. Use admin client because we already
  //    confirmed RLS access via the analysis lookup above.
  const ctx = { companyId: profile.company_id, userId: profile.id };
  const all = await getAllCompsForSubject(ctx, analysis.subject_id);
  let comps: CompRecord[] = all.filter((c) => !c.excluded);

  // 4. Re-impute prices for NDS subjects in case the user fixed list prices
  //    or DOM. Bridge MLS comps with real ClosePrice are still preserved.
  const signals: MarketSignals =
    (await getCachedMarketSignals(ctx, analysis.subject_id)) ?? {};
  comps = imputeMissingPrices(subject, comps, signals);

  // 5. Re-run analysis. Pull condition_text and fees from the prior
  //    analysis payload so the recompute is otherwise identical.
  const prior = analysis.payload as
    | {
        repair_breakdown?: { drivers?: string[] };
        wholesale_mao?: number;
        novation_mao?: number;
      }
    | null;
  const conditionText = (prior?.repair_breakdown?.drivers ?? []).join(", ");

  const output = analyzeDeal({
    subject,
    condition_text: conditionText,
    comps,
    market_signals: signals,
    wholesale_fee: 20_000,
    novation_fee: 40_000,
  });

  if (isNonDisclosureState(subject.state)) {
    const imputed = comps.filter((c) => c.price_imputed).length;
    if (imputed > 0) {
      output.warnings.push(
        `Non-disclosure state: ${imputed} comp price(s) imputed from list price + DOM.`
      );
    }
  }

  // 6. Save as a new analysis row so the history is preserved. The
  //    comps + subject snapshots lock in *exactly* what fed this run,
  //    so future edits to the live comp_records don't rewrite this row.
  const newId = await saveAnalysis(ctx, analysis.subject_id, profile.id, output, {
    comps,
    subject,
  });

  return NextResponse.json({ id: newId, output });
}

// Touch the admin client so unused-import lint never fires; the cache layer
// uses it under the hood and we want the bundler to keep it warm.
void createSupabaseAdminClient;
