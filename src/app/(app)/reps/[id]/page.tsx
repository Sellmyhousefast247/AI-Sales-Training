import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { TierBadge } from "@/components/TierBadge";
import { ScoreTrendChart } from "@/components/ScoreTrendChart";
import { formatDateTime, formatScore } from "@/lib/utils";
import { ROAD_TO_DEAL_STEPS, STEP_LABELS, STEP_NUMBER, type RoadStep, type Tier } from "@/lib/types";
import { StepCell, StepLegend, stepMap, stepStatus } from "@/components/StepChips";

export default async function RepProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const { data: rep } = await supabase
    .from("reps")
    .select("id, full_name, role_title, current_tier, current_avg_score, hire_date")
    .eq("id", id)
    .single();
  if (!rep) notFound();

  const [{ data: scoreRows }, { data: recentCalls }, { data: stepRows }] = await Promise.all([
    supabase
      .from("scorecards")
      .select("final_score, average_score, created_at")
      .eq("rep_id", id)
      .eq("is_current", true)
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("calls")
      .select(`
        id, call_datetime, call_type, deal_outcome, seller_name,
        scorecards!scorecards_call_id_fkey (final_score, average_score, is_current, step_scores (step, score))
      `)
      .eq("rep_id", id)
      .order("call_datetime", { ascending: false })
      .limit(10),
    supabase
      .from("step_scores")
      .select(`step, score, scorecards!inner(rep_id, is_current)`)
      .eq("scorecards.rep_id", id)
      .eq("scorecards.is_current", true),
  ]);

  const trend = (scoreRows ?? []).map((r) => ({
    date: new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    score: Number(r.final_score ?? r.average_score),
  }));

  const stepAgg = new Map<RoadStep, { sum: number; n: number }>();
  for (const r of stepRows ?? []) {
    const k = (r as any).step as RoadStep;
    const cur = stepAgg.get(k) ?? { sum: 0, n: 0 };
    cur.sum += Number((r as any).score);
    cur.n += 1;
    stepAgg.set(k, cur);
  }
  const stepAverages = [...stepAgg.entries()]
    .map(([step, v]) => ({ step, avg: v.sum / v.n }))
    .sort((a, b) => b.avg - a.avg);
  const strongest = stepAverages[0];
  const weakest = stepAverages[stepAverages.length - 1];

  return (
    <div className="space-y-6 p-8">
      <Link href="/reps" className="text-sm text-ink-500 hover:text-ink-900">← Back to reps</Link>

      <header className="flex flex-wrap items-center gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-ink-200 font-semibold text-ink-700">
          {rep.full_name.split(" ").map((s: string) => s[0]).slice(0, 2).join("")}
        </div>
        <div>
          <div className="text-2xl font-semibold">{rep.full_name}</div>
          <div className="text-sm text-ink-500">
            {rep.role_title ?? "Acquisitions Rep"}
            {rep.hire_date ? ` · joined ${rep.hire_date}` : ""}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <TierBadge tier={(rep.current_tier ?? 1) as Tier} />
          <div className="rounded-md border border-ink-200 bg-white px-4 py-2 text-sm">
            <div className="text-xs uppercase tracking-wide text-ink-500">Avg</div>
            <div className="font-mono text-lg tabular-nums">
              {rep.current_avg_score != null ? formatScore(Number(rep.current_avg_score)) : "—"}
            </div>
          </div>
        </div>
      </header>

      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <div className="mb-3 text-sm font-semibold">Score trend</div>
        {trend.length === 0 ? (
          <div className="text-sm text-ink-500">No scored calls yet.</div>
        ) : (
          <ScoreTrendChart data={trend} />
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-xs uppercase tracking-wide text-ink-500">Strongest step</div>
          <div className="mt-1 text-lg font-semibold">
            {strongest ? `${STEP_LABELS[strongest.step]} · ${formatScore(strongest.avg)}` : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-xs uppercase tracking-wide text-ink-500">Weakest step</div>
          <div className="mt-1 text-lg font-semibold">
            {weakest ? `${STEP_LABELS[weakest.step]} · ${formatScore(weakest.avg)}` : "—"}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <div className="mb-1 text-sm font-semibold">Road to a Deal — call by call</div>
        <div className="mb-3"><StepLegend /></div>
        {(() => {
          const scoredCalls = (recentCalls ?? [])
            .map((c: any) => {
              const s = (c.scorecards ?? []).find((x: any) => x.is_current);
              return s ? { call: c, steps: stepMap(s.step_scores), score: Number(s.final_score ?? s.average_score) } : null;
            })
            .filter(Boolean) as Array<{ call: any; steps: Partial<Record<RoadStep, number>>; score: number }>;
          if (scoredCalls.length === 0) {
            return <div className="text-sm text-ink-500">No scored calls yet.</div>;
          }
          const hitRate = (k: RoadStep) => {
            const scores = scoredCalls.map((r) => r.steps[k]).filter((v) => v != null) as number[];
            if (scores.length === 0) return null;
            return Math.round((scores.filter((v) => stepStatus(v) === "completed").length / scores.length) * 100);
          };
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-ink-500">
                    <th className="py-2 pr-3">Call</th>
                    {ROAD_TO_DEAL_STEPS.map((k) => (
                      <th key={k} className="px-1 py-2 text-center" title={STEP_LABELS[k]}>
                        {STEP_NUMBER[k]}
                      </th>
                    ))}
                    <th className="py-2 pl-3 text-right">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {scoredCalls.map(({ call, steps, score }) => (
                    <tr key={call.id} className="hover:bg-ink-50">
                      <td className="whitespace-nowrap py-2 pr-3">
                        <Link href={`/calls/${call.id}`} className="hover:underline">
                          {call.seller_name ?? formatDateTime(call.call_datetime)}
                        </Link>
                        <span className="ml-2 text-xs text-ink-400">
                          {new Date(call.call_datetime).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      </td>
                      {ROAD_TO_DEAL_STEPS.map((k) => (
                        <td key={k} className="px-1 py-2 text-center" title={STEP_LABELS[k]}>
                          <StepCell score={steps[k]} />
                        </td>
                      ))}
                      <td className="py-2 pl-3 text-right font-mono tabular-nums">{formatScore(score)}</td>
                    </tr>
                  ))}
                  <tr className="bg-ink-50 text-xs">
                    <td className="py-2 pr-3 font-semibold text-ink-500">Hit rate</td>
                    {ROAD_TO_DEAL_STEPS.map((k) => {
                      const pct = hitRate(k);
                      return (
                        <td key={k} className="px-1 py-2 text-center font-mono tabular-nums" title={STEP_LABELS[k]}>
                          {pct == null ? "—" : (
                            <span className={pct >= 70 ? "text-emerald-600" : pct >= 40 ? "text-amber-600" : "text-red-500"}>
                              {pct}%
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })()}
        <div className="mt-2 text-xs text-ink-400">
          Steps: {ROAD_TO_DEAL_STEPS.map((k) => `${STEP_NUMBER[k]} ${STEP_LABELS[k].split(" (")[0]}`).join(" · ")}
        </div>
      </section>

      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <div className="mb-3 text-sm font-semibold">Recent calls</div>
        <ul className="divide-y divide-ink-100 text-sm">
          {(recentCalls ?? []).map((c: any) => {
            const s = (c.scorecards ?? []).find((x: any) => x.is_current);
            const score = s ? Number(s.final_score ?? s.average_score) : null;
            return (
              <li key={c.id} className="flex items-center justify-between py-2">
                <Link href={`/calls/${c.id}`} className="hover:underline">
                  <span className="font-medium">{c.seller_name ?? "—"}</span>
                  <span className="ml-2 text-ink-500">{formatDateTime(c.call_datetime)}</span>
                  <span className="ml-2 capitalize text-ink-400">{c.call_type.replace("_", " ")}</span>
                </Link>
                <span className="font-mono tabular-nums">{score != null ? formatScore(score) : "—"}</span>
              </li>
            );
          })}
          {(recentCalls?.length ?? 0) === 0 && <li className="py-3 text-ink-500">No calls yet.</li>}
        </ul>
      </section>
    </div>
  );
}
