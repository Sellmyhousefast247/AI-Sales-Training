import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { formatDateTime, formatMoney, formatPct } from "@/lib/utils";

interface AnalysisRow {
  id: string;
  created_at: string;
  arv: number;
  as_is_value: number;
  repair_estimate: number;
  repair_level: string;
  buying_pct: number;
  wholesale_mao: number;
  novation_mao: number;
  confidence_score: "Low" | "Medium" | "High";
  comps_used: number;
  comp_subjects: { id: string; address: string; city: string | null; state: string | null } | null;
}

export default async function CompingListPage() {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("deal_analyses")
    .select(
      `
      id, created_at, arv, as_is_value, repair_estimate, repair_level,
      buying_pct, wholesale_mao, novation_mao, confidence_score, comps_used,
      comp_subjects:subject_id (id, address, city, state)
    `
    )
    .eq("company_id", profile.company_id)
    .order("created_at", { ascending: false })
    .limit(100);

  const rows: AnalysisRow[] = (data ?? []) as unknown as AnalysisRow[];

  return (
    <div className="space-y-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Comping</h1>
          <p className="text-sm text-ink-500">Deal analyses — ARV, repairs, and MAO offers</p>
        </div>
        <Link
          href="/comping/new"
          className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
        >
          + New analysis
        </Link>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          Failed to load analyses: {error.message}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink-300 bg-white p-10 text-center">
          <div className="text-sm font-medium text-ink-700">No analyses yet</div>
          <p className="mt-1 text-sm text-ink-500">
            Run your first deal to see it here. The form will walk you through it.
          </p>
          <Link
            href="/comping/new"
            className="mt-4 inline-block rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
          >
            Start your first analysis
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-ink-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Property</th>
                <th className="px-4 py-3 text-right">ARV</th>
                <th className="px-4 py-3 text-right">As-Is</th>
                <th className="px-4 py-3 text-right">Repairs</th>
                <th className="px-4 py-3 text-right">Wholesale MAO</th>
                <th className="px-4 py-3 text-right">Novation MAO</th>
                <th className="px-4 py-3">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r) => {
                const subj = r.comp_subjects;
                return (
                  <tr key={r.id} className="hover:bg-ink-50">
                    <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                      <Link href={`/comping/${r.id}`}>{formatDateTime(r.created_at)}</Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/comping/${r.id}`} className="font-medium text-ink-900 hover:underline">
                        {subj?.address ?? "—"}
                      </Link>
                      <div className="text-xs text-ink-500">
                        {[subj?.city, subj?.state].filter(Boolean).join(", ") || "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{formatMoney(r.arv)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(r.as_is_value)}</td>
                    <td className="px-4 py-3 text-right">
                      {formatMoney(r.repair_estimate)}
                      <div className="text-xs text-ink-500">{r.repair_level}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-700">{formatMoney(r.wholesale_mao)}</td>
                    <td className="px-4 py-3 text-right text-emerald-700">{formatMoney(r.novation_mao)}</td>
                    <td className="px-4 py-3">
                      <ConfidencePill value={r.confidence_score} />
                      <div className="text-xs text-ink-500">
                        {r.comps_used} comps · {formatPct(r.buying_pct, 0)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{value}</span>;
}
