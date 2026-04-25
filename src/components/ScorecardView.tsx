import {
  CATEGORY_LABELS,
  DISCOVERY_LABELS,
  SCORECARD_CATEGORIES,
  DISCOVERY_CHECKS,
  type ScoreCategory,
  type DiscoveryCheckKey,
} from "@/lib/types";
import { TierBadge } from "./TierBadge";
import { formatScore } from "@/lib/utils";

export interface ScorecardViewProps {
  totalScore: number;
  averageScore: number;
  tierBefore: number;
  tierAfter: number;
  dealRisk: "low" | "medium" | "high";
  conversionProbability: number;
  recommendedNextAction: string;
  categories: { category: ScoreCategory; score: number; justification?: string; supporting_quote?: string }[];
  discovery: { check_key: DiscoveryCheckKey; was_uncovered: boolean }[];
  biggestMistake: string;
  bestMoment: string;
  missedOpportunity: string;
  shouldHaveSaid: string;
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

export function ScorecardView(p: ScorecardViewProps) {
  const catMap = new Map(p.categories.map((c) => [c.category, c]));
  const discoveryMap = new Map(p.discovery.map((d) => [d.check_key, d.was_uncovered]));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-xs uppercase tracking-wide text-ink-500">Total</div>
          <div className="mt-2 text-3xl font-semibold">{formatScore(p.totalScore)}/100</div>
          <div className="mt-1 text-xs text-ink-500">avg {formatScore(p.averageScore)}/10</div>
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
          <div className="mt-2 text-xs text-ink-500">
            Conversion {p.conversionProbability}%
          </div>
        </div>
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="text-xs uppercase tracking-wide text-ink-500">Next action</div>
          <div className="mt-2 text-sm">{p.recommendedNextAction}</div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <div className="mb-3 text-sm font-semibold">Categories</div>
          <ul className="space-y-2 text-sm">
            {SCORECARD_CATEGORIES.map((k) => {
              const c = catMap.get(k);
              return (
                <li key={k} className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="font-medium">{CATEGORY_LABELS[k]}</div>
                    {c?.justification ? (
                      <div className="text-xs text-ink-500">{c.justification}</div>
                    ) : null}
                    {c?.supporting_quote ? (
                      <div className="mt-1 border-l-2 border-ink-200 pl-2 text-xs italic text-ink-600">
                        “{c.supporting_quote}”
                      </div>
                    ) : null}
                  </div>
                  <div className="font-mono text-base font-semibold tabular-nums">
                    {formatScore(c?.score ?? null)}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-ink-200 bg-white p-5">
            <div className="mb-3 text-sm font-semibold">Discovery checks</div>
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {DISCOVERY_CHECKS.map((k) => {
                const ok = discoveryMap.get(k);
                return (
                  <li key={k} className="flex items-center gap-2">
                    <span className={ok ? "text-emerald-600" : "text-rose-500"}>{ok ? "✓" : "✗"}</span>
                    <span className={ok ? "text-ink-800" : "text-ink-500"}>{DISCOVERY_LABELS[k]}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-lg border border-ink-200 bg-white p-5">
            <div className="mb-3 text-sm font-semibold">Coaching</div>
            <Block label="Biggest mistake" body={p.biggestMistake} />
            <Block label="Best moment" body={p.bestMoment} />
            <Block label="Missed opportunity" body={p.missedOpportunity} />
            <Block label="What they should have said" body={p.shouldHaveSaid} />
            <Block label="Suggested follow-up SMS" body={p.followupSms} />
            <Block label="Suggested follow-up email" body={p.followupEmail} />
            <Block label="Manager notes" body={p.managerNotes} />
            <Block label="Rep-friendly feedback" body={p.repNotes} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Block({ label, body }: { label: string; body: string }) {
  if (!body) return null;
  return (
    <div className="mt-3 first:mt-0">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm">{body}</div>
    </div>
  );
}
