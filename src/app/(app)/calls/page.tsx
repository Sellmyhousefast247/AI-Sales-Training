import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { formatDateTime } from "@/lib/utils";
import { StepChips, StepLegend, stepMap } from "@/components/StepChips";
import { ScoreCell } from "./ScoreCell";

export default async function CallsListPage() {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const [{ data: rows }, { data: integration }] = await Promise.all([
    supabase
      .from("calls")
      .select(`
        id, call_datetime, call_type, lead_source, deal_outcome, seller_name, external_contact_id,
        reps:rep_id (id, full_name),
        scorecards!scorecards_call_id_fkey (id, final_score, average_score, is_current, step_scores (step, score))
      `)
      .eq("company_id", profile.company_id)
      .order("call_datetime", { ascending: false })
      .limit(100),
    supabase
      .from("integrations")
      .select("config_json")
      .eq("company_id", profile.company_id)
      .eq("provider", "gohighlevel")
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  // Base URL for deep-linking a seller to their GHL/XLeads contact profile.
  const ghlLocationId = (integration?.config_json as any)?.ghl_location_id ?? null;
  const contactUrl = (contactId: string | null) =>
    ghlLocationId && contactId
      ? `https://login.xleads.com/v2/location/${ghlLocationId}/contacts/detail/${contactId}`
      : null;

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
              <th className="px-4 py-3"></th>
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
                  <td className="px-4 py-3 whitespace-nowrap text-ink-700">
                    {formatDateTime(c.call_datetime)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/calls/${c.id}`}
                      className="rounded-md border border-ink-300 bg-ink-100 px-3 py-1 text-xs font-medium text-ink-800 hover:bg-ink-200"
                    >
                      View
                    </Link>
                  </td>
                  <td className="px-4 py-3">{c.reps?.full_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      const url = contactUrl(c.external_contact_id);
                      const name = c.seller_name ?? "—";
                      return url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-brand hover:underline"
                          title="Open contact in GoHighLevel"
                        >
                          {name}
                        </a>
                      ) : (
                        <span className="font-medium text-ink-900">{name}</span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 capitalize">{c.call_type.replace("_", " ")}</td>
                  <td className="px-4 py-3">{c.lead_source ?? "—"}</td>
                  <td className="px-4 py-3 capitalize">{c.deal_outcome.replace("_", " ")}</td>
                  <td className="px-4 py-3">
                    <Link href={`/calls/${c.id}`} title="Open scorecard">
                      <StepChips steps={stepMap(cur?.step_scores)} />
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ScoreCell
                      callId={c.id}
                      score={cur ? Number(cur.final_score ?? cur.average_score) : null}
                    />
                  </td>
                </tr>
              );
            })}
            {(rows?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-ink-500">
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
