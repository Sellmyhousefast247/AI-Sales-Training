import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { formatDateTime, formatMoney, formatPct } from "@/lib/utils";
import type { AnalyzeDealOutput } from "@/lib/comping";
import type { CompSnapshot, SubjectSnapshot } from "@/lib/comping/snapshot";
import { CompsEditor, type CompRow } from "./CompsEditor";
import { ShareControls } from "./ShareControls";
import { computeDeltas, deltaIsImprovement, type AnalysisDeltas, type AnalysisNumbers, type DeltaKey, type NumberDelta } from "@/lib/comping/deltas";

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
  comps_snapshot: CompSnapshot[] | null;
  subject_snapshot: SubjectSnapshot | null;
  share_token: string | null;
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
      comps_snapshot, subject_snapshot, share_token,
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

  // Find the most recent prior analysis for the same subject so we can
  // surface trend deltas. Falls back to no-deltas on the first run.
  const deltas: AnalysisDeltas = subj?.id
    ? await loadDeltas(supabase, subj.id, row.id, row.created_at, currentNumbers(row))
    : {};

  const role = profile.role ?? "rep";
  const canShare =
    role === "manager" || role === "company_admin" || role === "super_admin";

  return (
    <div className="space-y-8 p-8">
      <header>
        <div className="flex items-center justify-between">
          <div>
            <Link href="/comping" className="no-print text-xs text-ink-500 hover:text-ink-900">
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
        <div className="mt-3">
          <ShareControls
            analysisId={row.id}
            initialToken={row.share_token}
            canShare={canShare}
          />
        </div>
      </header>

      {/* The numbers */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <BigStat
          label="Wholesale MAO"
          value={formatMoney(row.wholesale_mao)}
          hint={`ARV × 70% − repairs − $${(20_000).toLocaleString()}`}
          accent
          delta={deltas.wholesale_mao}
          deltaKey="wholesale_mao"
        />
        <BigStat
          label="Novation MAO"
          value={formatMoney(row.novation_mao)}
          hint={`As-Is × 90% − $${(40_000).toLocaleString()}`}
          accent
          delta={deltas.novation_mao}
          deltaKey="novation_mao"
        />
        <BigStat
          label="Market-Adjusted MAO"
          value={formatMoney(row.market_adjusted_mao)}
          hint={`ARV × ${formatPct(row.buying_pct)} − repairs − fee`}
          delta={deltas.market_adjusted_mao}
          deltaKey="market_adjusted_mao"
        />
      </section>

      {/* Comps + repairs */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="ARV (After Repair Value)">
          <div className="flex items-baseline gap-2">
            <div className="text-3xl font-semibold">{formatMoney(row.arv)}</div>
            {deltas.arv ? (
              <DeltaPill delta={deltas.arv} kind="money" good={deltaIsImprovement("arv", deltas.arv.diff)} />
            ) : null}
          </div>
          {row.arv_low && row.arv_high ? (
            <div className="mt-1 text-xs text-ink-500">
              Range {formatMoney(row.arv_low)} – {formatMoney(row.arv_high)}
            </div>
          ) : null}
          <div className="mt-3 text-xs text-ink-500">{row.comps_used} comps used</div>
        </Card>

        <Card title="As-Is Value">
          <div className="flex items-baseline gap-2">
            <div className="text-3xl font-semibold">{formatMoney(row.as_is_value)}</div>
            {deltas.as_is_value ? (
              <DeltaPill
                delta={deltas.as_is_value}
                kind="money"
                good={deltaIsImprovement("as_is_value", deltas.as_is_value.diff)}
              />
            ) : null}
          </div>
          <div className="mt-3 text-xs text-ink-500">What it sells for as-is, no rehab</div>
        </Card>

        <Card title="Repairs">
          <div className="flex items-baseline gap-2">
            <div className="text-3xl font-semibold">{formatMoney(row.repair_estimate)}</div>
            {deltas.repair_estimate ? (
              <DeltaPill
                delta={deltas.repair_estimate}
                kind="money"
                good={deltaIsImprovement("repair_estimate", deltas.repair_estimate.diff)}
              />
            ) : null}
          </div>
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

      {/* Subject details — prefer the immutable snapshot when present so
          historical analyses stay accurate after the live subject is
          edited. */}
      {(() => {
        const snapSubj = row.subject_snapshot;
        const beds = snapSubj?.beds ?? subj?.beds ?? null;
        const baths = snapSubj?.baths ?? subj?.baths ?? null;
        const sqft = snapSubj?.sqft ?? subj?.sqft ?? null;
        const yearBuilt = snapSubj?.year_built ?? subj?.year_built ?? null;
        const lotSqft = snapSubj?.lot_sqft ?? subj?.lot_sqft ?? null;
        const ptype = snapSubj?.property_type ?? subj?.property_type ?? null;
        if (!subj && !snapSubj) return null;
        return (
          <section className="rounded-lg border border-ink-200 bg-white p-5">
            <h2 className="text-sm font-semibold">
              Subject property
              {snapSubj ? (
                <span className="ml-2 text-xs font-normal text-ink-500">
                  (values at time of analysis)
                </span>
              ) : null}
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <Detail label="Beds" value={beds ?? "—"} />
              <Detail label="Baths" value={baths ?? "—"} />
              <Detail label="Sqft" value={sqft ? sqft.toLocaleString() : "—"} />
              <Detail label="Year built" value={yearBuilt ?? "—"} />
              <Detail label="Lot sqft" value={lotSqft ? lotSqft.toLocaleString() : "—"} />
              <Detail label="Type" value={(ptype ?? "—").replace("_", " ")} />
              <Detail label="Buying %" value={formatPct(row.buying_pct)} />
              <Detail label="Confidence" value={row.confidence_score} />
            </dl>
          </section>
        );
      })()}

      {/* Snapshot of the comps that fed this analysis — read-only.
          Independent of any later edits to the live comp_records. */}
      {row.comps_snapshot && row.comps_snapshot.length > 0 ? (
        <CompsSnapshotSection snapshot={row.comps_snapshot} />
      ) : null}

      {/* Live comps editor — operates on the *current* comp_records for
          the subject. Edits + recompute create a NEW analysis row with
          a fresh snapshot. */}
      <div className="no-print">
        <CompsEditor analysisId={row.id} comps={compRows} />
      </div>
    </div>
  );
}

function CompsSnapshotSection({ snapshot }: { snapshot: CompSnapshot[] }) {
  return (
    <section className="rounded-lg border border-ink-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold">Comps used in this analysis</h2>
          <p className="text-xs text-ink-500">
            {snapshot.length} comp{snapshot.length === 1 ? "" : "s"} — values frozen at the time of
            analysis. Edits below create a new analysis with an updated snapshot.
          </p>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-ink-50 text-left uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">List $</th>
              <th className="px-3 py-2 text-right">DOM</th>
              <th className="px-3 py-2 text-right">Beds</th>
              <th className="px-3 py-2 text-right">Baths</th>
              <th className="px-3 py-2 text-right">Sqft</th>
              <th className="px-3 py-2 text-right">$/sqft</th>
              <th className="px-3 py-2 text-right">Dist mi</th>
              <th className="px-3 py-2">Cond.</th>
              <th className="px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {snapshot.map((c, i) => {
              const ppsf = c.price > 0 && c.sqft > 0 ? Math.round(c.price / c.sqft) : null;
              return (
                <tr key={`${c.source_id ?? "na"}-${i}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-ink-700">{c.source}</div>
                    <div className="text-[10px] text-ink-400">{c.source_id ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2">{c.status}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(c.price)}</td>
                  <td className="px-3 py-2 text-right">
                    {c.list_price ? formatMoney(c.list_price) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">{c.dom_days ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{c.beds}</td>
                  <td className="px-3 py-2 text-right">{c.baths}</td>
                  <td className="px-3 py-2 text-right">{c.sqft.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-ink-500">{ppsf ? `$${ppsf}` : "—"}</td>
                  <td className="px-3 py-2 text-right">{c.distance_mi}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <span>{c.condition}</span>
                      <SnapshotConditionBadge source={c.condition_source ?? null} />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {c.price_imputed ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                        imputed
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function currentNumbers(row: AnalysisRow): AnalysisNumbers {
  return {
    arv: Number(row.arv),
    as_is_value: Number(row.as_is_value),
    repair_estimate: Number(row.repair_estimate),
    buying_pct: Number(row.buying_pct),
    wholesale_mao: Number(row.wholesale_mao),
    novation_mao: Number(row.novation_mao),
    market_adjusted_mao: Number(row.market_adjusted_mao),
  };
}

async function loadDeltas(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  subjectId: string,
  currentId: string,
  currentCreatedAt: string,
  current: AnalysisNumbers
): Promise<AnalysisDeltas> {
  const { data } = await supabase
    .from("deal_analyses")
    .select(
      `arv, as_is_value, repair_estimate, buying_pct,
       wholesale_mao, novation_mao, market_adjusted_mao`
    )
    .eq("subject_id", subjectId)
    .lt("created_at", currentCreatedAt)
    .neq("id", currentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return {};
  const prev: AnalysisNumbers = {
    arv: Number(data.arv),
    as_is_value: Number(data.as_is_value),
    repair_estimate: Number(data.repair_estimate),
    buying_pct: Number(data.buying_pct),
    wholesale_mao: Number(data.wholesale_mao),
    novation_mao: Number(data.novation_mao),
    market_adjusted_mao: Number(data.market_adjusted_mao),
  };
  return computeDeltas(current, prev);
}

async function loadComps(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  subjectId: string
): Promise<CompRow[]> {
  const { data } = await supabase
    .from("comp_records")
    .select(
      `id, source, source_id, status, price, list_price, dom_days, close_date,
       beds, baths, sqft, distance_mi, condition, condition_source,
       is_distressed, excluded, notes, remarks`
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
    condition_source: (r.condition_source as CompRow["condition_source"]) ?? null,
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
  delta,
  deltaKey,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  delta?: NumberDelta;
  deltaKey?: DeltaKey;
}) {
  return (
    <div className={`rounded-lg border p-5 ${accent ? "border-emerald-300 bg-emerald-50" : "border-ink-200 bg-white"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-ink-600">{label}</div>
        {delta && deltaKey ? <DeltaPill delta={delta} kind={kindOf(deltaKey)} good={deltaIsImprovement(deltaKey, delta.diff)} /> : null}
      </div>
      <div className={`mt-2 text-3xl font-semibold ${accent ? "text-emerald-900" : "text-ink-900"}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-ink-500">{hint}</div> : null}
    </div>
  );
}

function DeltaPill({
  delta,
  kind,
  good,
}: {
  delta: NumberDelta;
  kind: "money" | "pct";
  good: boolean | null;
}) {
  if (delta.diff === 0) return null;
  const arrow = delta.diff > 0 ? "↑" : "↓";
  const cls =
    good === null
      ? "bg-ink-100 text-ink-700"
      : good
        ? "bg-emerald-100 text-emerald-800"
        : "bg-red-100 text-red-800";
  const label =
    kind === "money"
      ? formatMoney(Math.abs(delta.diff))
      : `${(Math.abs(delta.diff) * 100).toFixed(1)}pp`;
  const pct =
    delta.pct === 0
      ? ""
      : ` (${(delta.pct > 0 ? "+" : "−")}${(Math.abs(delta.pct) * 100).toFixed(1)}%)`;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
      title="Change vs previous analysis for this subject"
    >
      {arrow} {label}
      {kind === "money" ? pct : ""}
    </span>
  );
}

function kindOf(k: DeltaKey): "money" | "pct" {
  return k === "buying_pct" ? "pct" : "money";
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

function SnapshotConditionBadge({
  source,
}: {
  source: CompSnapshot["condition_source"] | null | undefined;
}) {
  if (!source) return null;
  const map = {
    photos:   { label: "vision",   cls: "bg-blue-100 text-blue-800",       title: "Set by Claude photo classifier" },
    remarks:  { label: "text",     cls: "bg-amber-100 text-amber-800",     title: "Set by Claude text classifier on MLS remarks" },
    manual:   { label: "edited",   cls: "bg-emerald-100 text-emerald-800", title: "Edited by a user" },
    provider: { label: "provider", cls: "bg-ink-100 text-ink-700",         title: "Set by the data provider" },
  } as const;
  const meta = map[source];
  if (!meta) return null;
  return (
    <span title={meta.title} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  );
}
