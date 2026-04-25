import { TIER_META, type Tier } from "@/lib/types";

const TIER_BAR: Record<Tier, string> = {
  1: "bg-ink-400",
  2: "bg-cyan-500",
  3: "bg-blue-500",
  4: "bg-violet-500",
  5: "bg-amber-500",
};

const TIER_DOT: Record<Tier, string> = {
  1: "bg-ink-400",
  2: "bg-cyan-500",
  3: "bg-blue-500",
  4: "bg-violet-500",
  5: "bg-amber-500",
};

export function TierDistribution({ counts }: { counts: Record<Tier, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-ink-100">
        {([1, 2, 3, 4, 5] as Tier[]).map((t) => {
          const pct = total ? (counts[t] / total) * 100 : 0;
          if (!pct) return null;
          return (
            <div
              key={t}
              className={`${TIER_BAR[t]} transition-all`}
              style={{ width: `${pct}%` }}
              title={`Tier ${t}: ${counts[t]} (${pct.toFixed(0)}%)`}
            />
          );
        })}
      </div>

      <ul className="space-y-2 text-sm">
        {([1, 2, 3, 4, 5] as Tier[]).map((t) => {
          const count = counts[t];
          const pct = total ? (count / total) * 100 : 0;
          const meta = TIER_META[t];
          return (
            <li key={t} className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${TIER_DOT[t]}`} />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    T{t} · {meta.label}
                  </span>
                  <span className="font-mono tabular-nums text-ink-700">
                    {count} <span className="text-ink-400">({pct.toFixed(0)}%)</span>
                  </span>
                </div>
                <div className="text-xs text-ink-500">{meta.status}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
