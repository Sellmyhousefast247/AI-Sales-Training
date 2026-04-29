import type { RepairEstimate, RepairLevel } from "./types";

interface LevelSpec {
  level: RepairLevel;
  costPerSqft: { low: number; high: number };
  keywords: string[];
}

const LEVELS: LevelSpec[] = [
  {
    level: "Light",
    costPerSqft: { low: 10, high: 20 },
    keywords: [
      "paint", "carpet", "cosmetic", "minor", "clean out", "trash out",
      "turnkey", "move in ready", "deep clean", "landscaping", "fixtures",
    ],
  },
  {
    level: "Moderate",
    costPerSqft: { low: 20, high: 35 },
    keywords: [
      "kitchen update", "bath update", "bathroom update", "flooring",
      "new floors", "appliances", "hvac service", "minor roof", "water heater",
      "electrical update", "plumbing update", "outdated kitchen",
      "outdated bath", "outdated bathroom", "dated",
    ],
  },
  {
    level: "Heavy",
    costPerSqft: { low: 35, high: 55 },
    keywords: [
      "full kitchen", "full bath", "roof replacement", "new roof",
      "roof damage", "hvac replace", "new hvac", "windows", "siding",
      "rewire", "repipe", "septic", "well", "deck rebuild", "garage rebuild",
      "subfloor",
    ],
  },
  {
    level: "Full Gut",
    costPerSqft: { low: 55, high: 85 },
    keywords: [
      "gut", "down to studs", "foundation", "structural", "fire damage",
      "fire", "mold", "water damage", "flood", "addition", "asbestos",
      "termite", "uninhabitable", "condemned", "needs everything",
      "full rehab", "complete rehab",
    ],
  },
];

const HARD_OVERRIDES: { match: string; minLevel: RepairLevel }[] = [
  { match: "foundation", minLevel: "Heavy" },
  { match: "structural", minLevel: "Full Gut" },
  { match: "mold", minLevel: "Full Gut" },
  { match: "fire", minLevel: "Full Gut" },
  { match: "flood", minLevel: "Full Gut" },
  { match: "gut", minLevel: "Full Gut" },
  { match: "down to studs", minLevel: "Full Gut" },
];

const LEVEL_RANK: Record<RepairLevel, number> = {
  Light: 0,
  Moderate: 1,
  Heavy: 2,
  "Full Gut": 3,
};

const RANK_LEVEL: RepairLevel[] = ["Light", "Moderate", "Heavy", "Full Gut"];

export function estimateRepairs(sqft: number, conditionText: string): RepairEstimate {
  const text = conditionText.toLowerCase();
  const drivers: string[] = [];

  let bestLevel: RepairLevel = "Light";
  let bestScore = 0;

  for (const spec of LEVELS) {
    let score = 0;
    for (const kw of spec.keywords) {
      if (text.includes(kw)) {
        score += 1;
        drivers.push(kw);
      }
    }
    // Heavier levels need fewer hits to win — weight by rank.
    const weighted = score * (1 + LEVEL_RANK[spec.level] * 0.25);
    if (weighted > bestScore) {
      bestScore = weighted;
      bestLevel = spec.level;
    }
  }

  // No keywords matched → assume Light. Empty text → minimum estimate.
  if (bestScore === 0 && text.trim().length > 0) {
    bestLevel = "Light";
  }

  for (const override of HARD_OVERRIDES) {
    if (text.includes(override.match) && LEVEL_RANK[override.minLevel] > LEVEL_RANK[bestLevel]) {
      bestLevel = override.minLevel;
    }
  }

  // If multiple major systems are flagged, escalate.
  const majorSystems = ["roof", "hvac", "kitchen", "bath", "electrical", "plumbing"];
  const flagged = majorSystems.filter((s) => text.includes(s)).length;
  if (flagged >= 4 && LEVEL_RANK[bestLevel] < LEVEL_RANK["Heavy"]) {
    bestLevel = "Heavy";
  }
  if (flagged >= 5 && LEVEL_RANK[bestLevel] < LEVEL_RANK["Full Gut"]) {
    bestLevel = "Full Gut";
  }

  const spec = LEVELS.find((l) => l.level === bestLevel) ?? LEVELS[0];
  const low = Math.round(sqft * spec.costPerSqft.low);
  const high = Math.round(sqft * spec.costPerSqft.high);
  const point = Math.round((low + high) / 2);

  return {
    level: bestLevel,
    low,
    high,
    point,
    drivers: dedupe(drivers),
    cost_per_sqft: spec.costPerSqft,
  };
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export const _internal = { LEVELS, RANK_LEVEL };
