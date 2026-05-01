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
  {
    // Teardown: structure has no value, the deal is priced on the lot.
    // We model that as "rebuild from scratch" cost-per-sqft so MAOs
    // collapse toward zero unless lot value carries the deal — and the
    // analyzeDeal layer emits a warning prompting the user to value as
    // land instead.
    level: "Teardown",
    costPerSqft: { low: 180, high: 300 },
    keywords: [
      "teardown", "tear down", "tear-down", "demolish", "demolition",
      "scrape", "scrape lot", "land value only", "lot value only",
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
  Teardown: 4,
};

const RANK_LEVEL: RepairLevel[] = ["Light", "Moderate", "Heavy", "Full Gut", "Teardown"];

export interface DetectedRepairLevel {
  level: RepairLevel;
  drivers: string[];
  /** True when the text had no matching keywords at all. */
  empty: boolean;
}

/**
 * Pure keyword-driven detector. Same logic the form uses live to warn
 * the user when their manually-picked tier disagrees with their notes.
 */
export function detectRepairLevel(conditionText: string): DetectedRepairLevel {
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
    const weighted = score * (1 + LEVEL_RANK[spec.level] * 0.25);
    if (weighted > bestScore) {
      bestScore = weighted;
      bestLevel = spec.level;
    }
  }

  const empty = bestScore === 0;
  if (empty && text.trim().length > 0) bestLevel = "Light";

  for (const override of HARD_OVERRIDES) {
    if (text.includes(override.match) && LEVEL_RANK[override.minLevel] > LEVEL_RANK[bestLevel]) {
      bestLevel = override.minLevel;
    }
  }

  const majorSystems = ["roof", "hvac", "kitchen", "bath", "electrical", "plumbing"];
  const flagged = majorSystems.filter((s) => text.includes(s)).length;
  if (flagged >= 4 && LEVEL_RANK[bestLevel] < LEVEL_RANK["Heavy"]) bestLevel = "Heavy";
  if (flagged >= 5 && LEVEL_RANK[bestLevel] < LEVEL_RANK["Full Gut"]) bestLevel = "Full Gut";

  return { level: bestLevel, drivers: dedupe(drivers), empty };
}

/**
 * Size repairs from the condition text. Caller can pass an explicit
 * `override` level (the calculator form's "Repair tier" dropdown) and
 * the engine will use that instead of the keyword-detected level. The
 * detected level is still returned as `auto_level` so analyzeDeal can
 * warn when override and notes disagree.
 */
export function estimateRepairs(
  sqft: number,
  conditionText: string,
  override?: RepairLevel
): RepairEstimate {
  const detected = detectRepairLevel(conditionText);
  const finalLevel = override ?? detected.level;

  const spec = LEVELS.find((l) => l.level === finalLevel) ?? LEVELS[0];
  const low = Math.round(sqft * spec.costPerSqft.low);
  const high = Math.round(sqft * spec.costPerSqft.high);
  const point = Math.round((low + high) / 2);

  return {
    level: finalLevel,
    low,
    high,
    point,
    drivers: detected.drivers,
    cost_per_sqft: spec.costPerSqft,
    auto_level: detected.level,
    override_used: override != null && override !== detected.level,
  };
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export const _internal = { LEVELS, RANK_LEVEL };
