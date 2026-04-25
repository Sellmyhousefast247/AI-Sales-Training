import { ArrowDown, ArrowRight, ArrowUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  trend?: number | null;        // e.g. 0.12 = +12%
  trendInverse?: boolean;       // when up=bad (e.g. risk metrics)
  accent?: "ink" | "emerald" | "violet" | "amber" | "rose" | "cyan";
}

const ACCENT: Record<NonNullable<MetricCardProps["accent"]>, { iconBg: string; iconFg: string }> = {
  ink:     { iconBg: "bg-ink-100",     iconFg: "text-ink-700"     },
  emerald: { iconBg: "bg-emerald-100", iconFg: "text-emerald-700" },
  violet:  { iconBg: "bg-violet-100",  iconFg: "text-violet-700"  },
  amber:   { iconBg: "bg-amber-100",   iconFg: "text-amber-700"   },
  rose:    { iconBg: "bg-rose-100",    iconFg: "text-rose-700"    },
  cyan:    { iconBg: "bg-cyan-100",    iconFg: "text-cyan-700"    },
};

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  iconClassName,
  trend,
  trendInverse = false,
  accent = "ink",
}: MetricCardProps) {
  const accentStyles = ACCENT[accent];
  const trendOk = trend == null ? null : trendInverse ? trend < 0 : trend > 0;
  const trendNeutral = trend != null && Math.abs(trend) < 0.005;

  return (
    <div className="group relative overflow-hidden rounded-xl border border-ink-200 bg-white p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</div>
        {Icon ? (
          <div
            className={cn(
              "grid h-9 w-9 place-items-center rounded-lg",
              accentStyles.iconBg,
              iconClassName
            )}
          >
            <Icon className={cn("h-4 w-4", accentStyles.iconFg)} />
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <div className="text-3xl font-semibold tracking-tight text-ink-900">{value}</div>
        {trend != null && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium",
              trendNeutral
                ? "bg-ink-100 text-ink-600"
                : trendOk
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-rose-50 text-rose-700"
            )}
          >
            {trendNeutral ? (
              <ArrowRight className="h-3 w-3" />
            ) : trendOk ? (
              <ArrowUp className="h-3 w-3" />
            ) : (
              <ArrowDown className="h-3 w-3" />
            )}
            {Math.abs(trend * 100).toFixed(0)}%
          </span>
        )}
      </div>

      {hint ? <div className="mt-1 text-xs text-ink-500">{hint}</div> : null}
    </div>
  );
}
