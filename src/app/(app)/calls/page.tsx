import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { formatDateTime, formatScore } from "@/lib/utils";
import { StepChips, StepLegend, stepMap } from "@/components/StepChips";

export default async function CallsListPage() {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from("calls")
    .select(`
      id, call_datetime, call_type, lead_source, deal_outcome, seller_name,
      reps:rep_id (id, full_name),
      scorecards!scorecards_call_id_fkey (id, final_score, average_score, is_current, step_scores (step, score))
    `)
    .eq("company_id", profile.company_id)
    .order("call_datetime", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Calls</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/calls/import"
            className="rounded-md border border-ink-300 bg-ink-100 px-4 py-2 text-sm font-medium text-ink-800 hover:bg-ink-200"
          >
            Import recordings
          </Link>
          <Link
            href="/calls/new"
            className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
          >
            + New call
          </Link>
        </div>
      </header>

      <div className="overflow-hidden rounded-lg border border-ink-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Rep</th>
              <th className="px-4 py-3">Seller</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Outcome</th>
              <th className="px-4 py-3">Road to a Deal</th>
              <th className="px-4 py-3 text-right">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {(rows ?? []).map((c: any) => {
              const cur = (c.scorecards ?? []).find((s: any) => s.is_current);
              return (
                <tr key={c.id} className="hover:bg-ink-50">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link href={`/calls/${c.id}`} className="text-ink-900 hover:underline">
                      {formatDateTime(c.call_datetime)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{c.reps?.full_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Link href={`/calls/${c.id}`} className="font-medium text-ink-900 hover:underline">
                      {c.seller_name ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 capitalize">{c.call_type.replace("_", " ")}</td>
                  <td className="px-4 py-3">{c.lead_source ?? "—"}</td>
                  <td className="px-4 py-3 capitalize">{c.deal_outcome.replace("_", " ")}</td>
                  <td className="px-4 py-3">
                    <Link href={`/calls/${c.id}`} title="Open scorecard">
                      <StepChips steps={stepMap(cur?.step_scores)} />
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {cur ? formatScore(Number(cur.final_score ?? cur.average_score)) : "—"}
                  </td>
                </tr>
              );
            })}
            {(rows?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-ink-500">
                  No calls yet. <Link href="/calls/new" className="font-medium text-ink-900 hover:underline">Add your first call →</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <StepLegend />
    </div>
  );
}
