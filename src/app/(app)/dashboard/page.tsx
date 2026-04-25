import { redirect } from "next/navigation";
import { StatCard } from "@/components/StatCard";
import { TierBadge } from "@/components/TierBadge";
import { getCompany, getCurrentProfile, getDashboardStats, getRepsBasic } from "@/lib/queries";
import { formatScore } from "@/lib/utils";
import type { Tier } from "@/lib/types";

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");

  const company = await getCompany(profile.company_id);
  const [stats, reps] = await Promise.all([
    getDashboardStats(profile.company_id, 30),
    getRepsBasic(profile.company_id),
  ]);

  const repMap = new Map(reps.map((r) => [r.id, r]));
  const topRep = stats.topRepId ? repMap.get(stats.topRepId) : null;
  const weakestRep = stats.weakestRepId ? repMap.get(stats.weakestRepId) : null;

  const tierCounts: Record<Tier, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of reps) {
    const t = (r.current_tier ?? 1) as Tier;
    tierCounts[t] += 1;
  }

  const leaderboard = [...reps]
    .filter((r) => r.current_avg_score != null)
    .sort((a, b) => Number(b.current_avg_score) - Number(a.current_avg_score))
    .slice(0, 5);

  return (
    <div className="space-y-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{company?.name}</h1>
          <p className="text-sm text-ink-500">Last 30 days · all teams</p>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="Calls reviewed" value={stats.callsReviewed} />
        <StatCard label="Avg score" value={stats.avgScore != null ? formatScore(stats.avgScore) : "—"} hint="across all reps" />
        <StatCard label="Top rep" value={topRep?.full_name ?? "—"} hint={topRep ? `Tier ${topRep.current_tier}` : ""} />
        <StatCard label="Weakest rep" value={weakestRep?.full_name ?? "—"} hint={weakestRep ? "needs coaching" : ""} />
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="Contracts" value={stats.contracts} />
        <StatCard label="Appointments" value={stats.appointments} />
        <StatCard label="Offers made" value={stats.offers} />
        <StatCard label="Active reps" value={reps.length} />
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="mb-3 text-sm font-semibold">Tier distribution</div>
          <div className="space-y-2 text-sm">
            {[1, 2, 3, 4, 5].map((t) => {
              const count = tierCounts[t as Tier];
              const max = Math.max(...Object.values(tierCounts), 1);
              return (
                <div key={t} className="flex items-center gap-3">
                  <div className="w-24"><TierBadge tier={t as Tier} /></div>
                  <div className="flex-1">
                    <div className="h-2 rounded bg-ink-100">
                      <div
                        className="h-2 rounded bg-ink-700"
                        style={{ width: `${(count / max) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-8 text-right tabular-nums">{count}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="mb-3 text-sm font-semibold">Leaderboard — top 5 by avg score</div>
          {leaderboard.length === 0 ? (
            <div className="text-sm text-ink-500">No scored calls yet.</div>
          ) : (
            <ol className="space-y-2 text-sm">
              {leaderboard.map((r, i) => (
                <li key={r.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-5 text-ink-400">{i + 1}.</span>
                    <span className="font-medium">{r.full_name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono tabular-nums">{formatScore(Number(r.current_avg_score))}</span>
                    <TierBadge tier={(r.current_tier ?? 1) as Tier} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
