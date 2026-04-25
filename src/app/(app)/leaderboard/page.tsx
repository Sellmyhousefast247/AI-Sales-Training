import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { TierBadge } from "@/components/TierBadge";
import { formatScore } from "@/lib/utils";
import type { Tier } from "@/lib/types";

const BOARDS = [
  { key: "best_avg", label: "Best avg" },
  { key: "most_calls", label: "Most calls" },
  { key: "most_contracts", label: "Most contracts" },
] as const;

type BoardKey = typeof BOARDS[number]["key"];

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const { board } = await searchParams;
  const active: BoardKey = (BOARDS.find((b) => b.key === board)?.key ?? "best_avg") as BoardKey;

  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const { data: reps } = await supabase
    .from("reps")
    .select("id, full_name, current_tier, current_avg_score")
    .eq("company_id", profile.company_id)
    .eq("is_active", true);

  let rows: { rep_id: string; full_name: string; tier: Tier; metric: number; metricLabel: string }[] = [];

  if (active === "best_avg") {
    rows = (reps ?? [])
      .filter((r) => r.current_avg_score != null)
      .map((r) => ({
        rep_id: r.id,
        full_name: r.full_name,
        tier: (r.current_tier ?? 1) as Tier,
        metric: Number(r.current_avg_score),
        metricLabel: formatScore(Number(r.current_avg_score)),
      }))
      .sort((a, b) => b.metric - a.metric);
  } else if (active === "most_calls") {
    const since = new Date(); since.setDate(since.getDate() - 30);
    const { data: callRows } = await supabase
      .from("calls")
      .select("rep_id")
      .eq("company_id", profile.company_id)
      .gte("call_datetime", since.toISOString());
    const counts = new Map<string, number>();
    for (const r of callRows ?? []) counts.set(r.rep_id, (counts.get(r.rep_id) ?? 0) + 1);
    rows = (reps ?? []).map((r) => ({
      rep_id: r.id,
      full_name: r.full_name,
      tier: (r.current_tier ?? 1) as Tier,
      metric: counts.get(r.id) ?? 0,
      metricLabel: String(counts.get(r.id) ?? 0),
    })).sort((a, b) => b.metric - a.metric);
  } else if (active === "most_contracts") {
    const since = new Date(); since.setDate(since.getDate() - 30);
    const { data: callRows } = await supabase
      .from("calls")
      .select("rep_id, deal_outcome")
      .eq("company_id", profile.company_id)
      .eq("deal_outcome", "contract")
      .gte("call_datetime", since.toISOString());
    const counts = new Map<string, number>();
    for (const r of callRows ?? []) counts.set(r.rep_id, (counts.get(r.rep_id) ?? 0) + 1);
    rows = (reps ?? []).map((r) => ({
      rep_id: r.id,
      full_name: r.full_name,
      tier: (r.current_tier ?? 1) as Tier,
      metric: counts.get(r.id) ?? 0,
      metricLabel: String(counts.get(r.id) ?? 0),
    })).sort((a, b) => b.metric - a.metric);
  }

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Leaderboard</h1>
        <p className="text-sm text-ink-500">Last 30 days</p>
      </header>

      <nav className="flex gap-2 text-sm">
        {BOARDS.map((b) => (
          <Link
            key={b.key}
            href={`/leaderboard?board=${b.key}`}
            className={`rounded-md px-3 py-1.5 ${
              active === b.key ? "bg-ink-900 text-white" : "border border-ink-300 hover:bg-ink-100"
            }`}
          >
            {b.label}
          </Link>
        ))}
      </nav>

      <div className="overflow-hidden rounded-lg border border-ink-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3 w-12">#</th>
              <th className="px-4 py-3">Rep</th>
              <th className="px-4 py-3">Tier</th>
              <th className="px-4 py-3 text-right">{BOARDS.find((b) => b.key === active)!.label}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r, i) => (
              <tr key={r.rep_id}>
                <td className="px-4 py-3 text-ink-400">{i + 1}</td>
                <td className="px-4 py-3 font-medium">
                  <Link href={`/reps/${r.rep_id}`} className="hover:underline">{r.full_name}</Link>
                </td>
                <td className="px-4 py-3"><TierBadge tier={r.tier} /></td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{r.metricLabel}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-ink-500">No data yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
