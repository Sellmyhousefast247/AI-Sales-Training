import { ROAD_TO_DEAL_STEPS, STEP_LABELS, STEP_NUMBER, type RoadStep } from "@/lib/types";

/**
 * Road to a Deal step status, mentor-review style:
 *   10 → ✓ completed · 5 → △ weak/out of sequence · 0 → ✗ missing · null → — not scored
 */
export type StepStatus = "completed" | "weak" | "missing" | "none";

export function stepStatus(score: number | null | undefined): StepStatus {
  if (score == null) return "none";
  if (score >= 8) return "completed";
  if (score >= 3) return "weak";
  return "missing";
}

export const STEP_GLYPH: Record<StepStatus, string> = {
  completed: "✓",
  weak: "△",
  missing: "✗",
  none: "—",
};

const CHIP_CLASS: Record<StepStatus, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  weak: "bg-amber-100 text-amber-700",
  missing: "bg-red-100 text-red-600",
  none: "bg-ink-100 text-ink-400",
};

const CELL_CLASS: Record<StepStatus, string> = {
  completed: "text-emerald-600",
  weak: "text-amber-600",
  missing: "text-red-500",
  none: "text-ink-300",
};

export function stepTitle(step: RoadStep, status: StepStatus): string {
  const label = `${STEP_NUMBER[step]}. ${STEP_LABELS[step]}`;
  const word =
    status === "completed" ? "Completed" :
    status === "weak" ? "Weak / out of sequence" :
    status === "missing" ? "Missing" : "Not scored";
  return `${label} — ${word}`;
}

/** Build a step→score map from a step_scores relation array. */
export function stepMap(rows: Array<{ step: string; score: number }> | null | undefined) {
  const m: Partial<Record<RoadStep, number>> = {};
  for (const r of rows ?? []) m[r.step as RoadStep] = Number(r.score);
  return m;
}

/**
 * Compact 10-chip preview of a call's Road to a Deal execution.
 * Used on the calls list; each chip tooltips its step name + status.
 */
export function StepChips({ steps }: { steps: Partial<Record<RoadStep, number>> }) {
  const scored = ROAD_TO_DEAL_STEPS.some((k) => steps[k] != null);
  if (!scored) return <span className="text-ink-300">—</span>;
  return (
    <span className="inline-flex gap-0.5 whitespace-nowrap">
      {ROAD_TO_DEAL_STEPS.map((k) => {
        const st = stepStatus(steps[k]);
        return (
          <span
            key={k}
            title={stepTitle(k, st)}
            className={`grid h-5 w-5 place-items-center rounded text-[11px] font-semibold leading-none ${CHIP_CLASS[st]}`}
          >
            {STEP_GLYPH[st]}
          </span>
        );
      })}
    </span>
  );
}

/** Single matrix cell (glyph only) for the rep-dashboard grid. */
export function StepCell({ score }: { score: number | null | undefined }) {
  const st = stepStatus(score);
  return <span className={`font-semibold ${CELL_CLASS[st]}`}>{STEP_GLYPH[st]}</span>;
}

export function StepLegend() {
  return (
    <div className="text-xs text-ink-500">
      <span className="mr-3"><span className="font-semibold text-emerald-600">✓</span> Completed</span>
      <span className="mr-3"><span className="font-semibold text-amber-600">△</span> Weak / out of sequence</span>
      <span className="mr-3"><span className="font-semibold text-red-500">✗</span> Missing</span>
      <span><span className="font-semibold text-ink-300">—</span> Not scored</span>
    </div>
  );
}
