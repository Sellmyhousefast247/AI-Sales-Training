import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { formatDateTime, formatMoney, formatPct } from "@/lib/utils";
import type { AnalyzeDealOutput } from "@/lib/comping";
import { CompsEditor, type CompRow } from "./CompsEditor";

interface AnalysisRow {
  id: string;
  created_at: string;
  arv: number;
  arv_low: number | null;
  arv_high: number | null;
  as_is_value: number;
  repair_estimate: number;
  repair_level: string;
  buying_pct: number;
  wholesale_mao: number;
  novation_mao: number;
  market_adjusted_mao: number;
  confidence_score: "Low" | "Medium" | "High";
  comps_used: number;
  warnings: unknown;
  payload: AnalyzeDealOutput;
  comp_subjects: {
    id: string;
    address: string;
    city: string | null;
    state: string | null;
    zip: string | null;
    beds: number | null;
    baths: number | null;
    sqft: number | null;
    year_built: number | null;
    lot_sqft: number | null;
    property_type: string | null;
  } | null;
}

export default async function AnalysisDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");

  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("deal_analyses")
    .select(
      `
      id, created_at, arv, arv_low, arv_high, as_is_value,
      repair_estimate, repair_level, buying_pct,
      wholesale_mao, novation_mao, market_adjusted_mao,
      confidence_score, comps_used, warnings, payload,
      comp_subjects:subject_id (
        id, address, city, state, zip, beds, baths, sqft, year_built, lot_sqft, property_type
      )
    `
    )
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .maybeSingle();

  if (error || !data) notFound();

  const row = data as unknown as AnalysisRow;
  const subj = row.comp_subjects;
  const breakdown = row.payload?.repair_breakdown;
  const warnings = Array.isArray(row.warnings) ? (row.warnings as string[]) : [];

  // Pull all comps for the subject (including excluded) so the editor can
  // surface them. RLS on comp_records keeps this tenant-scoped.
  const compRows: CompRow[] = subj?.id
    ? await loadComps(supabase, subj.id)
    : [];

  return (
    <div className="space-y-8 p-8">
      <header>
        <div className="flex items-center justify-between">
          <div>
            <Link href="/comping" className="text-xs text-ink-500 hover:text-ink-900">
              ← Back to comping
            </Link>
            <h1 className="mt-1 text-2xl font-semibold">{subj?.address ?? "Analysis"}</h1>
            <p className="text-sm text-ink-500">
              {[subj?.city, subj?.state, subj?.zip].filter(Boolean).join(", ") || "—"} ·{" "}
              {formatDateTime(row.created_at)}
            </p>
          </div>
          <ConfidencePill value={row.confidence_score} />
        </div>
      </header>

      {/* The numbers */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <BigStat
          label="Wholesale MAO"
          value={formatMoney(row.wholesale_mao)}
          hint={`ARV × 70% − repairs − $${(20_000).toLocaleString()}`}
          accent
        />
        <BigStat
          label="Novation MAO"
          value={formatMoney(row.novation_mao)}
          hint={`As-Is × 90% − $${(40_000).toLocaleString()}`}
          accent
        />
        <BigStat
          label="Market-Adjusted MAO"
          value={formatMoney(row.market_adjusted_mao)}
          hint={`ARV × ${formatPct(row.buying_pct)} − repairs − fee`}
        />
      </section>

      {/* Comps + repairs */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="ARV (After Repair Value)">
          <div className="text-3xl font-semibold">{formatMoney(row.arv)}</div>
          {row.arv_low && row.arv_high ? (
            <div className="mt-1 text-xs text-ink-500">
              Range {formatMoney(row.arv_low)} – {formatMoney(row.arv_high)}
            </div>
          ) : null}
          <div className="mt-3 text-xs text-ink-500">{row.comps_used} comps used</div>
        </Card>

        <Card title="As-Is Value">
          <div className="text-3xl font-semibold">{formatMoney(row.as_is_value)}</div>
          <div className="mt-3 text-xs text-ink-500">What it sells for as-is, no rehab</div>
        </Card>

        <Card title="Repairs">
          <div className="text-3xl font-semibold">{formatMoney(row.repair_estimate)}</div>
          <div className="mt-1 text-sm font-medium text-ink-700">{row.repair_level}</div>
          {breakdown ? (
            <div className="mt-1 text-xs text-ink-500">
              {formatMoney(breakdown.low)} – {formatMoney(breakdown.high)}
              {breakdown.cost_per_sqft ? (
                <>
                  {" · "}${breakdown.cost_per_sqft.low}–${breakdown.cost_per_sqft.high}/sqft
                </>
              ) : null}
            </div>
          ) : null}
          {breakdown?.drivers && breakdown.drivers.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {breakdown.drivers.map((d) => (
                <span
                  key={d}
                  className="rounded bg-ink-100 px-2 py-0.5 text-xs text-ink-700"
                >
                  {d}
                </span>
              ))}
            </div>
          ) : null}
        </Card>
      </section>

      {/* Warnings */}
      {warnings.length > 0 ? (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-900">Heads up</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Subject details */}
      {subj ? (
        <section className="rounded-lg border border-ink-200 bg-white p-5">
          <h2 className="text-sm font-semibold">Subject property</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Detail label="Beds" value={subj.beds ?? "—"} />
            <Detail label="Baths" value={subj.baths ?? "—"} />
            <Detail label="Sqft" value={subj.sqft ? subj.sqft.toLocaleString() : "—"} />
            <Detail label="Year built" value={subj.year_built ?? "—"} />
            <Detail label="Lot sqft" value={subj.lot_sqft ? subj.lot_sqft.toLocaleString() : "—"} />
            <Detail label="Type" value={(subj.property_type ?? "—").replace("_", " ")} />
            <Detail label="Buying %" value={formatPct(row.buying_pct)} />
            <Detail label="Confidence" value={row.confidence_score} />
          </dl>
        </section>
      ) : null}

      {/* Comps editor — let users override what providers returned and
          recompute. */}
      <CompsEditor analysisId={row.id} comps={compRows} />
    </div>
  );
}

async function loadComps(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  subjectId: string
): Promise<CompRow[]> {
  const { data } = await supabase
    .from("comp_records")
    .select(
      `id, source, source_id, status, price, list_price, dom_days, close_date,
       beds, baths, sqft, distance_mi, condition, is_distressed, excluded,
       notes, remarks`
    )
    .eq("subject_id", subjectId)
    .order("status", { ascending: true })
    .order("distance_mi", { ascending: true });
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as string,
    source: (r.source as string) ?? "",
    source_id: (r.source_id as string) ?? null,
    status: r.status as CompRow["status"],
    price: Number(r.price ?? 0),
    list_price: r.list_price == null ? null : Number(r.list_price),
    dom_days: r.dom_days == null ? null : Number(r.dom_days),
    close_date: (r.close_date as string) ?? null,
    beds: Number(r.beds ?? 0),
    baths: Number(r.baths ?? 0),
    sqft: Number(r.sqft ?? 0),
    distance_mi: Number(r.distance_mi ?? 0),
    condition: r.condition as CompRow["condition"],
    is_distressed: !!r.is_distressed,
    excluded: !!r.excluded,
    notes: (r.notes as string | null) ?? null,
    remarks: (r.remarks as string | null) ?? null,
  }));
}

function BigStat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-5 ${accent ? "border-emerald-300 bg-emerald-50" : "border-ink-200 bg-white"}`}>
      <div className="text-xs uppercase tracking-wide text-ink-600">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${accent ? "text-emerald-900" : "text-ink-900"}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-ink-500">{hint}</div> : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-5">
      <div className="text-xs uppercase tracking-wide text-ink-500">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-1 font-medium text-ink-900">{value}</dd>
    </div>
  );
}

function ConfidencePill({ value }: { value: "Low" | "Medium" | "High" }) {
  const cls =
    value === "High"
      ? "bg-emerald-100 text-emerald-800"
      : value === "Medium"
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";
  return <span className={`inline-block rounded px-2 py-1 text-xs font-medium ${cls}`}>{value} confidence</span>;
}
