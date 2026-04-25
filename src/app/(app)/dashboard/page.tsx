import Link from "next/link";
import { redirect } from "next/navigation";
import {
  PhoneCall,
  Sparkles,
  FileSignature,
  Target,
  ArrowRight,
} from "lucide-react";
import {
  getCoachingPriorities,
  getCompany,
  getCurrentProfile,
  getDashboardStats,
  getRepsBasic,
} from "@/lib/queries";
import { formatScore } from "@/lib/utils";
import type { Tier } from "@/lib/types";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { TeamScoreTrendChart } from "@/components/dashboard/TeamScoreTrendChart";
import { TierDistribution } from "@/components/dashboard/TierDistribution";
import { RiskDonut } from "@/components/dashboard/RiskDonut";
import { TopPerformers, MostImprovedCard } from "@/components/dashboard/TopPerformers";
import { CoachingPriorities } from "@/components/dashboard/CoachingPriorities";

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) redirect("/login");

  const [company, stats, reps, coachingNotes] = await Promise.all([
    getCompany(profile.company_id),
    getDashboardStats(profile.company_id, 30),
    getRepsBasic(profile.company_id),
    getCoachingPriorities(profile.company_id, 5),
  ]);

  const repMap = new Map(reps.map((r) => [r.id, r]));
  const topRep = stats.topRepId ? repMap.get(stats.topRepId) : null;
  const mostImprovedRep = stats.mostImprovedRepId ? repMap.get(stats.mostImprovedRepId) : null;
  const mostImprovedDelta =
    stats.topRepsByImprovement.find((r) => r.rep_id === stats.mostImprovedRepId)?.delta ?? 0;

  const tierCounts: Record<Tier, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of reps) {
    const t = (r.current_tier ?? 1) as Tier;
    tierCounts[t] += 1;
  }

  const leaderboard = [...reps]
    .filter((r) => r.current_avg_score != null)
    .sort((a, b) => Number(b.current_avg_score) - Number(a.current_avg_score))
    .slice(0, 5)
    .map((r) => ({
      rep_id: r.id,
      full_name: r.full_name,
      tier: (r.current_tier ?? 1) as Tier,
      metric: Number(r.current_avg_score),
      metricLabel: formatScore(Number(r.current_avg_score)),
    }));

  // Trend math
  const callsTrend =
    stats.callsReviewedPrior > 0
      ? (stats.callsReviewed - stats.callsReviewedPrior) / stats.callsReviewedPrior
      : null;
  const avgScoreTrend =
    stats.avgScore != null && stats.avgScorePrior != null && stats.avgScorePrior > 0
      ? (stats.avgScore - stats.avgScorePrior) / stats.avgScorePrior
      : null;
  const contractsTrend =
    stats.contractsPrior > 0
      ? (stats.contracts - stats.contractsPrior) / stats.contractsPrior
      : null;
  const conversionTrend =
    stats.conversionRate != null && stats.conversionRatePrior != null && stats.conversionRatePrior > 0
      ? (stats.conversionRate - stats.conversionRatePrior) / stats.conversionRatePrior
      : null;

  const conversionPct =
    stats.conversionRate != null ? `${(stats.conversionRate * 100).toFixed(1)}%` : "—";

  return (
    <div className="space-y-8 p-6 md:p-8">
      {/* Hero header */}
      <header className="overflow-hidden rounded-2xl bg-gradient-to-br from-ink-900 via-ink-800 to-ink-700 p-6 text-white shadow-lg md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-white/60">Company</div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">
              {company?.name}
            </h1>
            <p className="mt-2 text-sm text-white/70">
              Last 30 days · {reps.length} active rep{reps.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/calls/new"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-ink-900 shadow-sm transition hover:shadow-md"
            >
              + New call
            </Link>
            <Link
              href="/leaderboard"
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/10"
            >
              Leaderboard
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Top metrics */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Calls reviewed"
          value={stats.callsReviewed}
          icon={PhoneCall}
          accent="cyan"
          trend={callsTrend}
        />
        <MetricCard
          label="Avg score"
          value={stats.avgScore != null ? formatScore(stats.avgScore) : "—"}
          icon={Sparkles}
          accent="emerald"
          trend={avgScoreTrend}
          hint="across scored calls"
        />
        <MetricCard
          label="Contracts"
          value={stats.contracts}
          icon={FileSignature}
          accent="violet"
          trend={contractsTrend}
        />
        <MetricCard
          label="Conversion"
          value={conversionPct}
          icon={Target}
          accent="amber"
          trend={conversionTrend}
          hint={`${stats.contracts} contracts · ${stats.appointments} appts · ${stats.offers} offers`}
        />
      </section>

      {/* Trend chart */}
      <section className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm md:p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Team score trend</div>
            <div className="text-xs text-ink-500">Daily average · last 30 days</div>
          </div>
          <div className="hidden items-center gap-3 text-xs text-ink-500 sm:flex">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Avg score
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm border-t border-dashed border-ink-400" />
              Target 7.5
            </span>
          </div>
        </div>
        <TeamScoreTrendChart data={stats.trendPoints} target={7.5} />
      </section>

      {/* Two-column rows */}
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm md:p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Top performers</div>
              <div className="text-xs text-ink-500">By rolling average score</div>
            </div>
            <Link
              href="/leaderboard"
              className="text-xs font-medium text-ink-700 hover:text-ink-900"
            >
              See all →
            </Link>
          </div>
          <TopPerformers rows={leaderboard} />
        </div>

        <div className="space-y-4">
          {mostImprovedRep ? (
            <MostImprovedCard
              fullName={mostImprovedRep.full_name}
              delta={mostImprovedDelta}
              repId={mostImprovedRep.id}
              tier={(mostImprovedRep.current_tier ?? 1) as Tier}
            />
          ) : null}

          {topRep ? (
            <Link
              href={`/reps/${topRep.id}`}
              className="block rounded-2xl border border-ink-200 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="text-xs font-medium uppercase tracking-wide text-amber-700">Top rep</div>
              <div className="mt-2 text-lg font-semibold">{topRep.full_name}</div>
              <div className="mt-1 font-mono text-2xl tabular-nums text-amber-700">
                {formatScore(Number(topRep.current_avg_score ?? 0))}
              </div>
              <div className="mt-1 text-xs text-ink-500">{topRep.role_title ?? "Acquisitions Rep"}</div>
            </Link>
          ) : null}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm md:p-6">
          <div className="mb-4">
            <div className="text-sm font-semibold">Tier distribution</div>
            <div className="text-xs text-ink-500">Where your team stands today</div>
          </div>
          <TierDistribution counts={tierCounts} />
        </div>

        <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm md:p-6">
          <div className="mb-4">
            <div className="text-sm font-semibold">Deal risk</div>
            <div className="text-xs text-ink-500">From calls scored in the last 30 days</div>
          </div>
          <RiskDonut
            low={stats.riskDistribution.low}
            medium={stats.riskDistribution.medium}
            high={stats.riskDistribution.high}
          />
        </div>

        <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm md:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Coaching priorities</div>
              <div className="text-xs text-ink-500">Last 7 days</div>
            </div>
            <Link href="/coaching" className="text-xs font-medium text-ink-700 hover:text-ink-900">
              View all →
            </Link>
          </div>
          <CoachingPriorities notes={coachingNotes as any} />
        </div>
      </section>
    </div>
  );
}
