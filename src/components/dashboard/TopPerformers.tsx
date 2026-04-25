import Link from "next/link";
import { Trophy, TrendingUp } from "lucide-react";
import { TierBadge } from "@/components/TierBadge";
import { formatScore } from "@/lib/utils";
import type { Tier } from "@/lib/types";

interface RepRow {
  rep_id: string;
  full_name: string;
  tier: Tier;
  metric: number;
  metricLabel: string;
}

export function TopPerformers({ rows }: { rows: RepRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="grid place-items-center rounded-lg border border-dashed border-ink-200 bg-ink-50/50 px-4 py-8 text-sm text-ink-500">
        No scored calls yet — score a call to populate the leaderboard.
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {rows.map((r, i) => {
        const podium = i === 0 ? "ring-2 ring-amber-300" : "";
        const initials = r.full_name
          .split(" ")
          .map((s) => s[0])
          .slice(0, 2)
          .join("");
        return (
          <li key={r.rep_id}>
            <Link
              href={`/reps/${r.rep_id}`}
              className={`group flex items-center gap-3 rounded-lg border border-ink-200 bg-white p-3 transition-shadow hover:shadow-md ${podium}`}
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-ink-100 text-xs font-semibold text-ink-600">
                {i + 1}
              </span>
              <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-ink-700 to-ink-900 text-sm font-semibold text-white">
                {initials}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.full_name}</div>
                <div className="mt-0.5"><TierBadge tier={r.tier} /></div>
              </div>
              <div className="text-right">
                <div className="font-mono text-lg font-semibold tabular-nums">{r.metricLabel}</div>
                {i === 0 ? (
                  <div className="flex items-center justify-end gap-1 text-[10px] uppercase tracking-wide text-amber-600">
                    <Trophy className="h-3 w-3" /> Top rep
                  </div>
                ) : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

export function MostImprovedCard({
  fullName,
  delta,
  repId,
  tier,
}: {
  fullName: string;
  delta: number;
  repId: string;
  tier: Tier;
}) {
  return (
    <Link
      href={`/reps/${repId}`}
      className="block rounded-lg border border-ink-200 bg-gradient-to-br from-emerald-50 to-white p-4 transition-shadow hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">Most improved</div>
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
          <TrendingUp className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-2 text-base font-semibold">{fullName}</div>
      <div className="mt-1 flex items-center gap-2">
        <TierBadge tier={tier} />
        <span className="font-mono text-sm tabular-nums text-emerald-700">
          +{formatScore(delta)} pts
        </span>
      </div>
    </Link>
  );
}
