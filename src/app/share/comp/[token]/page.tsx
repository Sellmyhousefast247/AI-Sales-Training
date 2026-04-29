import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { formatDateTime, formatMoney, formatPct } from "@/lib/utils";
import type { AnalyzeDealOutput } from "@/lib/comping";
import type { CompSnapshot, SubjectSnapshot } from "@/lib/comping/snapshot";

export const runtime = "nodejs";

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
}

export default async function ShareCompPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Public page — admin client bypasses RLS, but we constrain by the
  // token, which is the only thing the caller could possibly know.
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("deal_analyses")
    .select(
      `id, created_at, arv, arv_low, arv_high, as_is_value,
       repair_estimate, repair_level, buying_pct,
       wholesale_mao, novation_mao, market_adjusted_mao,
       confidence_score, comps_used, warnings, payload,
       comps_snapshot, subject_snapshot, share_token`
    )
    .eq("share_token", token)
    .maybeSingle();

  if (error || !data) notFound();
  const row = data as unknown as AnalysisRow;
  const subj = row.subject_snapshot;
  const breakdown = row.payload?.repair_breakdown;
  const warnings = Array.isArray(row.warnings) ? (row.warnings as string[]) : [];

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{subj?.address ?? "Deal analysis"}</h1>
          <p className="text-sm text-ink-500">
            {[subj?.city, subj?.state, subj?.zip].filter(Boolean).join(", ") || "—"} ·{" "}
            {formatDateTime(row.created_at)}
          </p>
        </div>
        <ConfidencePill value={row.confidence_score} />
      </header>

      {/* Headline numbers */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <BigStat
          label="Wholesale MAO"
          value={formatMoney(row.wholesale_mao)}
          hint={"ARV × 70% − repairs − $20,000"}
          accent
        />
        <BigStat
          label="Novation MAO"
          value={formatMoney(row.novation_mao)}
          hint={"As-Is × 90% − $40,000"}
          accent
        />
        <BigStat
          label="Market-Adjusted MAO"
          value={formatMoney(row.market_adjusted_mao)}
          hint={`ARV × ${formatPct(row.buying_pct)} − repairs − fee`}
        />
      </section>

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
                <span key={d} className="rounded bg-ink-100 px-2 py-0.5 text-xs text-ink-700">
                  {d}
                </span>
              ))}
            </div>
          ) : null}
        </Card>
      </section>

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

      {row.comps_snapshot && row.comps_snapshot.length > 0 ? (
        <section className="rounded-lg border border-ink-200 bg-white">
          <header className="border-b border-ink-200 px-5 py-3">
            <h2 className="text-sm font-semibold">Comps used</h2>
            <p className="text-xs text-ink-500">
              {row.comps_snapshot.length} comp
              {row.comps_snapshot.length === 1 ? "" : "s"} — values frozen at the time of analysis.
            </p>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-ink-50 text-left uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">Beds</th>
                  <th className="px-3 py-2 text-right">Baths</th>
                  <th className="px-3 py-2 text-right">Sqft</th>
                  <th className="px-3 py-2 text-right">$/sqft</th>
                  <th className="px-3 py-2 text-right">Dist mi</th>
                  <th className="px-3 py-2">Cond.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {row.comps_snapshot.map((c, i) => {
                  const ppsf = c.price > 0 && c.sqft > 0 ? Math.round(c.price / c.sqft) : null;
                  return (
                    <tr key={i}>
                      <td className="px-3 py-2">{c.status}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(c.price)}</td>
                      <td className="px-3 py-2 text-right">{c.beds}</td>
                      <td className="px-3 py-2 text-right">{c.baths}</td>
                      <td className="px-3 py-2 text-right">{c.sqft.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-ink-500">{ppsf ? `$${ppsf}` : "—"}</td>
                      <td className="px-3 py-2 text-right">{c.distance_mi}</td>
                      <td className="px-3 py-2">{c.condition}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <footer className="border-t border-ink-200 pt-4 text-xs text-ink-500">
        Read-only shared analysis · generated {formatDateTime(row.created_at)}.
      </footer>
    </main>
  );
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
