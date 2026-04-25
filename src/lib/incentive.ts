import type { Tier } from "./types";

export interface IncentiveRules {
  weekly_bonus: { tier: Tier; amount: number; min_calls: number }[];
  monthly_bonus: { tier: Tier; amount: number }[];
  awards: {
    most_improved?: number;
    highest_avg?: number;
    most_contracts?: number;
    best_discovery?: number;
    best_closing?: number;
    coaching_completion?: number;
  };
}

export const DEFAULT_RULES: IncentiveRules = {
  weekly_bonus: [
    { tier: 2, amount: 100, min_calls: 30 },
    { tier: 3, amount: 200, min_calls: 30 },
    { tier: 4, amount: 350, min_calls: 25 },
    { tier: 5, amount: 500, min_calls: 20 },
  ],
  monthly_bonus: [
    { tier: 4, amount: 1000 },
    { tier: 5, amount: 2500 },
  ],
  awards: {
    most_improved: 250,
    highest_avg: 250,
    most_contracts: 500,
    best_discovery: 100,
    best_closing: 100,
    coaching_completion: 100,
  },
};

export interface RepWeekStats {
  rep_id: string;
  tier: Tier;
  calls_count: number;
  avg_score: number;
  contracts: number;
  discovery_avg: number;
  closing_avg: number;
  improvement_delta: number; // current avg - prior period avg
  coaching_acked_pct: number; // 0..1
}

export interface IncentiveProjection {
  rep_id: string;
  weekly_bonus_amount: number;
  awards: { key: string; amount: number }[];
  total: number;
}

export function projectWeeklyIncentives(
  reps: RepWeekStats[],
  rules: IncentiveRules = DEFAULT_RULES
): IncentiveProjection[] {
  // Identify award winners across the cohort
  const sortedByImprovement = [...reps].sort((a, b) => b.improvement_delta - a.improvement_delta);
  const sortedByAvg = [...reps].sort((a, b) => b.avg_score - a.avg_score);
  const sortedByContracts = [...reps].sort((a, b) => b.contracts - a.contracts);
  const sortedByDiscovery = [...reps].sort((a, b) => b.discovery_avg - a.discovery_avg);
  const sortedByClosing = [...reps].sort((a, b) => b.closing_avg - a.closing_avg);

  const winnerIds = {
    most_improved: sortedByImprovement[0]?.rep_id,
    highest_avg: sortedByAvg[0]?.rep_id,
    most_contracts: sortedByContracts[0]?.rep_id,
    best_discovery: sortedByDiscovery[0]?.rep_id,
    best_closing: sortedByClosing[0]?.rep_id,
  };

  return reps.map((r) => {
    const weeklyMatch = rules.weekly_bonus.find(
      (b) => b.tier === r.tier && r.calls_count >= b.min_calls
    );
    const weekly = weeklyMatch?.amount ?? 0;

    const awards: { key: string; amount: number }[] = [];
    for (const [key, amount] of Object.entries(rules.awards)) {
      if (!amount) continue;
      const winnerId = (winnerIds as Record<string, string | undefined>)[key];
      if (winnerId === r.rep_id) awards.push({ key, amount });
    }
    if (rules.awards.coaching_completion && r.coaching_acked_pct >= 1) {
      awards.push({ key: "coaching_completion", amount: rules.awards.coaching_completion });
    }

    const total = weekly + awards.reduce((acc, a) => acc + a.amount, 0);
    return {
      rep_id: r.rep_id,
      weekly_bonus_amount: weekly,
      awards,
      total,
    };
  });
}
