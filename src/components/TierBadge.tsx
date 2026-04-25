import { TIER_META, type Tier } from "@/lib/types";
import { cn } from "@/lib/utils";

const COLORS: Record<Tier, string> = {
  1: "bg-tier-1/15 text-ink-700",
  2: "bg-tier-2/20 text-cyan-700",
  3: "bg-tier-3/20 text-blue-700",
  4: "bg-tier-4/20 text-violet-700",
  5: "bg-tier-5/20 text-amber-700",
};

export function TierBadge({ tier }: { tier: Tier }) {
  const meta = TIER_META[tier];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        COLORS[tier]
      )}
    >
      T{tier} · {meta.label}
    </span>
  );
}
