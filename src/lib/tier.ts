import type { Tier, RollingWindow } from "./types";
import { TIER_META } from "./types";

export function tierFromAverage(avg: number): Tier {
  if (avg >= 9.0) return 5;
  if (avg >= 8.0) return 4;
  if (avg >= 6.5) return 3;
  if (avg >= 5.0) return 2;
  return 1;
}

export function tierLabel(t: Tier): string {
  return TIER_META[t].label;
}

export interface ScoreSample {
  average_score: number;
  created_at: string; // ISO
}

export interface ComputeRepTierArgs {
  scores: ScoreSample[];
  window: RollingWindow;
  minCallsToLeaveTier1?: number;
  now?: Date;
}

export interface ComputeRepTierResult {
  tier: Tier;
  rolling_avg: number | null;
  sample_size: number;
  window_used: RollingWindow;
}

export function computeRepTier({
  scores,
  window,
  minCallsToLeaveTier1 = 5,
  now = new Date(),
}: ComputeRepTierArgs): ComputeRepTierResult {
  const sorted = [...scores].sort((a, b) => b.created_at.localeCompare(a.created_at));

  let sample: ScoreSample[] = [];
  switch (window) {
    case "last_10":
      sample = sorted.slice(0, 10);
      break;
    case "last_30d": {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 30);
      sample = sorted.filter((s) => new Date(s.created_at) >= cutoff);
      break;
    }
    case "all_time":
      sample = sorted;
      break;
  }

  if (sample.length === 0) {
    return { tier: 1, rolling_avg: null, sample_size: 0, window_used: window };
  }

  const avg = sample.reduce((acc, s) => acc + s.average_score, 0) / sample.length;
  let tier = tierFromAverage(avg);

  // Floor: a rep cannot leave Tier 1 with fewer than min calls
  if (sample.length < minCallsToLeaveTier1) tier = 1;

  return {
    tier,
    rolling_avg: round(avg, 2),
    sample_size: sample.length,
    window_used: window,
  };
}

function round(n: number, places: number) {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}
