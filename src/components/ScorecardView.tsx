import {
  ROAD_TO_DEAL_STEPS,
  STEP_LABELS,
  STEP_NUMBER,
  STEP_SCORE_LABEL,
  type RoadStep,
  type StepScore,
  type CriticalBreakpoint,
  type ImprovementItem,
  type MissedOpportunity,
} from "@/lib/types";
import { TierBadge } from "./TierBadge";
import { formatScore } from "@/lib/utils";

export interface ScorecardViewProps {
  totalScore: number;       // 0–100
  finalScore: number;       // 0–10
  tierBefore: number;
  tierAfter: number;
  dealRisk: "low" | "medium" | "high";
  conversionProbability: number;
  recommendedNextAction: string;

  steps: { step: RoadStep; score: StepScore; justification?: string; supporting_quote?: string }[];

  criticalBreakpoint: CriticalBreakpoint | null;
  whatWasDoneWell: string;
  areasForImprovement: ImprovementItem[];
  missedOpportunities: MissedOpportunity[];
  improvedCallFlowSummary: string;

  followupSms: string;
  followupEmail: string;
  managerNotes: string;
  repNotes: string;
}

const RISK_STYLE: Record<ScorecardViewProps["dealRisk"], string> = {
  low: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-rose-100 text-rose-700",
};

const STEP_PILL: Record<StepScore, string> = {
  0: "bg-rose-100 text-rose-700",
  5: "bg-amber-100 text-amber-700",
  10: "bg-emerald-100 text-emerald-700",
};

export function ScorecardView(p: ScorecardViewProps) {
  const stepMap = new Map(p.steps.map((s) => [s.step, s]));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-xs uppercase tracking-wide text-ink-500">Total</div>
          <div className="mt-2 text-3xl font-semibold">{p.totalScore}/100</div>
          <div className="mt-1 text-xs text-ink-500">final {formatScore(p.finalScore)}/10</div>
        </div>
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-xs uppercase tracking-wide text-ink-500">Tier impact</div>
          <div className="mt-2 flex items-center gap-2">
            <TierBadge tier={p.tierBefore as 1 | 2 | 3 | 4 | 5} />
            <span className="text-ink-400">→</span>
            <TierBadge tier={p.tierAfter as 1 | 2 | 3 | 4 | 5} />
          </div>
        </div>
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-xs uppercase tracking-wide text-ink-500">Deal risk</div>
          <div className="mt-2">
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${RISK_STYLE[p.dealRisk]}`}>
              {p.dealRisk}
            </span>
          </div>
          <div className="mt-2 text-xs text-ink-500">Conversion {p.conversionProbability}%</div>
        </div>
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-xs uppercase tracking-wide text-ink-500">Next action</div>
          <div className="mt-2 text-sm">{p.recommendedNextAction}</div>
        </div>
      </div>

      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <div className="mb-3 text-sm font-semibold">Road to a Deal — step breakdown</div>
        <ul className="space-y-2 text-sm">
          {ROAD_TO_DEAL_STEPS.map((k) => {
            const s = stepMap.get(k);
            const score = (s?.score ?? 0) as StepScore;
            return (
              <li key={k} className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="font-medium">
                    {STEP_NUMBER[k]}. {STEP_LABELS[k]}
                  </div>
                  {s?.justification ? (
                    <div className="text-xs text-ink-500">{s.justification}</div>
                  ) : null}
                  {s?.supporting_quote ? (
                    <div className="mt-1 border-l-2 border-ink-200 pl-2 text-xs italic text-ink-600">
                      “{s.supporting_quote}”
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STEP_PILL[score]}`}>
                    {STEP_SCORE_LABEL[score]}
                  </span>
                  <span className="font-mono text-base font-semibold tabular-nums">{score}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {p.criticalBreakpoint && (
        <section className="rounded-lg border-2 border-rose-300 bg-rose-50 p-5">
          <div className="text-xs uppercase tracking-wide text-rose-700">Critical breakpoint</div>
          <div className="mt-1 text-sm font-semibold">
            Step {STEP_NUMBER[p.criticalBreakpoint.step_failed]} — {STEP_LABELS[p.criticalBreakpoint.step_failed]}
          </div>
          <Quote text={p.criticalBreakpoint.quote} />
          <Block label="Why it caused loss" body={p.criticalBreakpoint.why_it_caused_loss} />
          <Block label="What should have happened" body={p.criticalBreakpoint.what_should_have_happened} />
        </section>
      )}

      {p.whatWasDoneWell && (
        <section className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-sm font-semibold">What was done well</div>
          <div className="mt-2 whitespace-pre-wrap text-sm">{p.whatWasDoneWell}</div>
        </section>
      )}

      {p.areasForImprovement.length > 0 && (
        <section className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-sm font-semibold">Areas for improvement</div>
          <div className="mt-3 space-y-5">
            {p.areasForImprovement.map((item, i) => (
              <div key={i} className="border-l-2 border-ink-200 pl-4">
                {item.step ? (
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-500">
                    Step {STEP_NUMBER[item.step]} — {STEP_LABELS[item.step]}
                  </div>
                ) : null}
                <div className="text-xs font-medium uppercase tracking-wide text-ink-500">REP SAID</div>
                <Quote text={item.rep_said} />
                <Block label="ISSUE" body={item.issue} />
                <Block label="BETTER APPROACH" body={item.better_approach} />
                <Block label="CORRECTED SCRIPT" body={item.corrected_script} quoted />
              </div>
            ))}
          </div>
        </section>
      )}

      {p.missedOpportunities.length > 0 && (
        <section className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-sm font-semibold">Missed opportunities</div>
          <ul className="mt-3 space-y-3 text-sm">
            {p.missedOpportunities.map((m, i) => (
              <li key={i} className="border-l-2 border-ink-200 pl-3">
                {m.rep_said ? <Quote text={m.rep_said} /> : null}
                <div><span className="font-medium">Missed:</span> {m.what_was_missed}</div>
                <div className="text-ink-700"><span className="font-medium">Fix:</span> {m.fix}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.improvedCallFlowSummary && (
        <section className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-sm font-semibold">Improved call flow summary</div>
          <div className="mt-2 whitespace-pre-wrap text-sm">{p.improvedCallFlowSummary}</div>
        </section>
      )}

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-sm font-semibold">Follow-up SMS</div>
          <div className="mt-2 whitespace-pre-wrap text-sm">{p.followupSms}</div>
        </div>
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-sm font-semibold">Follow-up email</div>
          <div className="mt-2 whitespace-pre-wrap text-sm">{p.followupEmail}</div>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-sm font-semibold">Manager coaching notes</div>
          <div className="mt-2 whitespace-pre-wrap text-sm">{p.managerNotes}</div>
        </div>
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-sm font-semibold">Rep-friendly feedback</div>
          <div className="mt-2 whitespace-pre-wrap text-sm">{p.repNotes}</div>
        </div>
      </section>
    </div>
  );
}

function Quote({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="mt-1 border-l-2 border-ink-300 bg-ink-50 px-3 py-2 text-sm italic text-ink-800">
      “{text}”
    </div>
  );
}

function Block({ label, body, quoted = false }: { label: string; body: string; quoted?: boolean }) {
  if (!body) return null;
  return (
    <div className="mt-3">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</div>
      {quoted ? (
        <Quote text={body} />
      ) : (
        <div className="mt-1 whitespace-pre-wrap text-sm">{body}</div>
      )}
    </div>
  );
}
