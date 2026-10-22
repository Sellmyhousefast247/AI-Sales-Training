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
  intro: "Introduction",
  reveal: "Reveal",
  obstacles: "Obstacles & Time",
  future_pace: "Future Pace",
  assessment: "Assessment",
  positioning: "Positioning",
  hold_process: "Hold & Process",
  offer: "Offer",
  close_negotiation: "Close & Negotiate",
  contract_wrapup: "Contract & Wrap",
};

/** One-line coaching pointer per step, used in Focus Areas. */
const COACHING_TIP: Record<RoadStep, string> = {
  intro: "Set the frame early: 'this first call is pretty basic', 'speed is important, right?', 'are you in a position to move forward?' — then the notepad info and the JC file number.",
  reveal: "Don't accept the first answer — ask 'what made you ready now?', then keep probing (goal 7+ questions) until the seller feels the pain. This should be the longest part of the call.",
  obstacles: "Nail the timeline ('ideally, when would you like to…'), what they've tried, what stopped them, and 'why not just list it with a realtor?'",
  future_pace: "Get them talking about life after the sale: 'no longer dealing with X, finally Y — how different is that? What are you looking forward to most? How's that going to feel?'",
  assessment: "Run the full walkthrough — outside first (neighborhood, roof, HVAC, structure), then inside (updates, flooring, plumbing, electric) — and finish with the $50k Home Depot question.",
  positioning: "Before price: deadline, decision-makers, the NEEDS number, mortgage balance, the 40-50% investor conditioning, then 'would you have any concerns at that point?' — and stay on it until there are none.",
  hold_process: "Set the hold up as approval-or-denial, come back with the underwriting questions, walk the whole process, and ask 'any questions or concerns about the process?' before the second hold.",
  offer: "Present it as a qualification — CONGRATS or 'came in around where I thought' — tie the net to their dream outcome, give ONE specific odd number, and if it's low ask what they were hoping to hear.",
  close_negotiation: "Never negotiate live — find the gap, bring it to the team, move in small steps. Pivot to the Equity Protection Program when stuck, then isolate: 'if you had that amount in your pocket… any other reason you wouldn't move forward?'",
  contract_wrapup: "Send the contract on the call and stay on until it's signed — name/price/address check, initials, pages 2-3 — then wrap strong: access schedule, TC + Curtis handoff, 210 number, 'Have a blessed day!'",
};

/** Encouragement line per step, used in Strengths. */
const STRENGTH_LINE: Record<RoadStep, string> = {
  intro: "Strong openers — sellers know who you are and what's coming.",
  reveal: "Digging into the seller's WHY is carrying these calls.",
  obstacles: "Clear timelines and obstacles are setting up every close.",
  future_pace: "Painting life after the sale is pulling sellers forward.",
  assessment: "Thorough walkthroughs — sellers feel you're the real deal.",
  positioning: "Pre-handling concerns before price is paying off.",
  hold_process: "The hold and process walk-through are landing with authority.",
  offer: "Confident offer presentation — the number lands as a qualification.",
  close_negotiation: "Steady under pressure — that's closer instinct.",
  contract_wrapup: "Strong finishes. Contracts get signed and sellers stay confident.",
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
