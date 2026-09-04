import { ROAD_TO_DEAL_STEPS, STEP_LABELS, type RoadStep } from "@/lib/types";

/**
 * Closer Profile — per-rep skill attributes built from step_scores.
 * Server-rendered SVG radar + bar meters in the app's navy/cyan theme.
 */

const BRAND = "#38BDF8";       // brand cyan (data marks)
const SURFACE = "#182136";     // card navy ("white" token)
const GRID = "#263352";        // ink-200
const AXIS_TEXT = "#93A3C6";   // ink-500

/** Short display name per step (radar labels + bars). */
export const SHORT_LABEL: Record<RoadStep, string> = {
  rapport: "Rapport",
  motivation: "Motivation",
  asking_price: "Asking Price",
  trial_close_1: "Trial Close 1",
  first_hold: "First Hold",
  anchor: "Anchor",
  negotiation: "Negotiation",
  trial_close_2: "Trial Close 2",
  second_hold: "Second Hold",
  approval_close: "Approval Close",
};

/** One-line coaching pointer per step, used in Focus Areas. */
const COACHING_TIP: Record<RoadStep, string> = {
  rapport: "Slow the opener down — confirm their name, ask permission, and mirror their energy before any price talk.",
  motivation: "Run the full WHY discovery: situation, condition, timeline, and the emotional impact behind the move.",
  asking_price: "Deliver the education pitch before asking — 'here's how companies like ours work' — then get their number.",
  trial_close_1: "Ask the conditional-commitment question and wait for a clean YES before moving forward. A maybe is a no.",
  first_hold: "Set up the hold on purpose: recap what you heard, tell them why you're stepping away, and give a time.",
  anchor: "Anchor below your target with a reason attached, and let silence do the work after the number.",
  negotiation: "Trade, don't chase — every concession should come with a condition, and re-use their motivation to justify moves.",
  trial_close_2: "Re-close after the number moves: 'if we land at X, is this done today?' before touching the paperwork.",
  second_hold: "Use the second hold to build authority — bring the 'approval' back with energy and a deadline.",
  approval_close: "Assume the close: walk the agreement line by line and lock next steps with both decision-makers present.",
};

/** Encouragement line per step, used in Strengths. */
const STRENGTH_LINE: Record<RoadStep, string> = {
  rapport: "Sellers open up fast — keep leading with that connection.",
  motivation: "Digging into the seller's WHY is carrying these calls.",
  asking_price: "Getting to a number early gives every call a spine.",
  trial_close_1: "Locking early commitment is setting up the close.",
  first_hold: "The hold is landing with purpose — keep that structure.",
  anchor: "Confident anchoring is winning the price conversation.",
  negotiation: "Trading well under pressure — that's closer instinct.",
  trial_close_2: "Re-closing after the number moves is sealing deals.",
  second_hold: "The authority play is working — keep the energy up.",
  approval_close: "Strong finishes. The paperwork walk-through closes.",
};

export type StepAvg = { step: RoadStep; avg: number; n: number };

function polar(cx: number, cy: number, r: number, i: number, total: number) {
  const angle = (Math.PI * 2 * i) / total - Math.PI / 2;
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function RadarChart({ byStep }: { byStep: Map<RoadStep, StepAvg> }) {
  const cx = 170, cy = 150, R = 96, total = ROAD_TO_DEAL_STEPS.length;
  const rings = [2.5, 5, 7.5, 10];

  const ringPolys = rings.map((v) =>
    ROAD_TO_DEAL_STEPS.map((_, i) => {
      const p = polar(cx, cy, (v / 10) * R, i, total);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }).join(" ")
  );

  const pts = ROAD_TO_DEAL_STEPS.map((step, i) => {
    const avg = byStep.get(step)?.avg ?? 0;
    return { step, avg, ...polar(cx, cy, (Math.max(0, Math.min(10, avg)) / 10) * R, i, total) };
  });
  const dataPoly = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <svg viewBox="0 0 340 300" role="img" aria-label="Skill radar across the 10 Road to a Deal steps" className="w-full max-w-[380px]">
      {ringPolys.map((poly, i) => (
        <polygon key={i} points={poly} fill="none" stroke={GRID} strokeWidth={1} />
      ))}
      {ROAD_TO_DEAL_STEPS.map((step, i) => {
        const edge = polar(cx, cy, R, i, total);
        return <line key={step} x1={cx} y1={cy} x2={edge.x} y2={edge.y} stroke={GRID} strokeWidth={1} />;
      })}
      <polygon points={dataPoly} fill={BRAND} fillOpacity={0.18} stroke={BRAND} strokeWidth={2} strokeLinejoin="round" />
      {pts.map((p) => (
        <circle key={p.step} cx={p.x} cy={p.y} r={3.5} fill={BRAND} stroke={SURFACE} strokeWidth={2}>
          <title>{`${SHORT_LABEL[p.step]}: ${p.avg.toFixed(1)} / 10`}</title>
        </circle>
      ))}
      {ROAD_TO_DEAL_STEPS.map((step, i) => {
        const lp = polar(cx, cy, R + 16, i, total);
        const anchor = Math.abs(lp.x - cx) < 12 ? "middle" : lp.x > cx ? "start" : "end";
        const avg = byStep.get(step)?.avg;
        return (
          <text key={step} x={lp.x} y={lp.y} textAnchor={anchor} dominantBaseline="middle" fontSize={9.5} fill={AXIS_TEXT}>
            {SHORT_LABEL[step]}
            <tspan x={lp.x} dy={11} fontSize={8.5} fill={AXIS_TEXT} fillOpacity={0.75}>
              {avg != null ? `${avg.toFixed(1)}/10` : "—"}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}

export function CloserProfile({ repFirstName, stepAverages }: { repFirstName: string; stepAverages: StepAvg[] }) {
  if (stepAverages.length === 0) return null;
  const byStep = new Map<RoadStep, StepAvg>(stepAverages.map((s) => [s.step, s]));
  const ranked = [...stepAverages].sort((a, b) => b.avg - a.avg);
  const strengths = ranked.slice(0, 3).filter((s) => s.avg >= 3);
  const focus = ranked.slice(-3).reverse().filter((s) => s.avg < 8);

  return (
    <>
      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <div className="mb-1 text-sm font-semibold">
          Skill attributes — {repFirstName}&rsquo;s closer profile
        </div>
        <div className="mb-4 text-xs text-ink-400">
          Average score per Road-to-a-Deal step across all scored calls
        </div>
        <div className="grid items-center gap-6 lg:grid-cols-2">
          <div className="flex justify-center"><RadarChart byStep={byStep} /></div>
          <div className="space-y-2.5">
            {ROAD_TO_DEAL_STEPS.map((step) => {
              const s = byStep.get(step);
              const pct = s ? Math.max(0, Math.min(100, (s.avg / 10) * 100)) : 0;
              return (
                <div key={step} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 text-xs text-ink-600">{SHORT_LABEL[step]}</div>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-ink-700">
                    {s ? `${s.avg.toFixed(1)} / 10` : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
            ✓ Strengths — keep leaning on these
          </div>
          <ul className="mt-3 space-y-3">
            {strengths.length === 0 && (
              <li className="text-sm text-ink-500">Scores are still building — strengths will show here soon.</li>
            )}
            {strengths.map((s) => (
              <li key={s.step} className="text-sm">
                <span className="font-semibold">{SHORT_LABEL[s.step]}</span>
                <span className="ml-2 font-mono text-xs tabular-nums text-emerald-600">{s.avg.toFixed(1)}/10</span>
                <div className="mt-0.5 text-xs text-ink-500">{STRENGTH_LINE[s.step]}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-600">
            △ Focus areas — biggest score unlocks
          </div>
          <ul className="mt-3 space-y-3">
            {focus.length === 0 && (
              <li className="text-sm text-ink-500">Nothing below 8/10 — outstanding across the board.</li>
            )}
            {focus.map((s) => (
              <li key={s.step} className="text-sm">
                <span className="font-semibold">{SHORT_LABEL[s.step]}</span>
                <span className="ml-2 font-mono text-xs tabular-nums text-amber-600">{s.avg.toFixed(1)}/10</span>
                <div className="mt-0.5 text-xs text-ink-500">{COACHING_TIP[s.step]}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
