import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { TierBadge } from "@/components/TierBadge";
import { ScoreTrendChart } from "@/components/ScoreTrendChart";
import { formatDateTime, formatScore } from "@/lib/utils";
import { STEP_LABELS, type RoadStep, type Tier } from "@/lib/types";

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
        id, call_datetime, call_type, deal_outcome,
        scorecards!scorecards_call_id_fkey (final_score, average_score, is_current)
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
          {rep.full_name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
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
        <div className="mb-3 text-sm font-semibold">Recent calls</div>
        <ul className="divide-y divide-ink-100 text-sm">
          {(recentCalls ?? []).map((c: any) => {
            const s = (c.scorecards ?? []).find((x: any) => x.is_current);
            const score = s ? Number(s.final_score ?? s.average_score) : null;
            return (
              <li key={c.id} className="flex items-center justify-between py-2">
                <Link href={`/calls/${c.id}`} className="hover:underline">
                  {formatDateTime(c.call_datetime)}
                  <span className="ml-2 capitalize text-ink-500">{c.call_type.replace("_", " ")}</span>
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
