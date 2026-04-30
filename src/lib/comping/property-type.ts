import type { PropertyType } from "./types";

/**
 * Property-type classification + compatibility rules.
 *
 * Used by every provider mapper so the four sources don't drift, and by
 * the comp pipeline to enforce that we never silently compare a
 * manufactured home to a stick-built single-family — the markets are
 * fundamentally different and the resulting ARV would be wrong.
 */

const PATTERNS: Array<[PropertyType, RegExp]> = [
  // Order matters — most specific first.
  ["manufactured", /\b(manufactured|mobile\s*home|trailer)\b|\bmh\b|\bmh\s*park\b/i],
  ["land", /\b(land|vacant\s*lot|vacant\s*land|raw\s*land|undeveloped)\b/i],
  ["condo", /\b(condo|condominium)\b/i],
  ["townhouse", /\b(townhouse|town\s*home|townhome|town[- ]home)\b/i],
  ["multi_family", /\b(duplex|triplex|fourplex|four[-\s]?plex|quadplex|quad)\b/i],
  ["multi_family", /\bmulti[-\s]?family\b|\bmulti[-\s]?unit\b|\b2-?4\s*units?\b/i],
  ["single_family", /\b(single\s*family|sfr|sfh|detached)\b/i],
];

/**
 * Detect a property type from any free-text blob (provider's
 * PropertyType + PropertySubType, MLS remarks, ATTOM propclass, ...).
 * Returns null when nothing matches; callers decide their default.
 */
export function detectPropertyType(blob: unknown): PropertyType | null {
  const s = String(blob ?? "").toLowerCase();
  if (!s) return null;
  for (const [type, re] of PATTERNS) {
    if (re.test(s)) return type;
  }
  return null;
}

/**
 * Same shape as `detectPropertyType` but with a default for callers
 * that need a concrete type. Single-family is by far the most common
 * U.S. property type, so it's the safest fallback.
 */
export function detectPropertyTypeOrDefault(blob: unknown): PropertyType {
  return detectPropertyType(blob) ?? "single_family";
}

/**
 * Property types that should NEVER fall back to "compatible" types.
 * These markets are valued differently enough (income approach for
 * multi-family, dealer-vs-park dynamics for manufactured, vacant-land
 * comps) that mixing them would introduce real error.
 */
const STRICT_TYPES = new Set<PropertyType>(["manufactured", "multi_family", "land"]);

export function isStrictPropertyType(t: PropertyType): boolean {
  return STRICT_TYPES.has(t);
}

/**
 * Types that the pipeline may fall back to when same-type comps are
 * sparse. For SFR / townhouse the buyer pool overlaps materially —
 * they sit in adjacent slices of the same market and a 1500 sqft
 * townhouse vs a 1500 sqft starter SFR comp within 0.25 mi is a
 * defensible relaxation. Condo stays alone (HOA dynamics distort
 * pure $/sqft). Strict types map to themselves.
 */
const COMPATIBLE: Record<PropertyType, PropertyType[]> = {
  single_family: ["single_family", "townhouse"],
  townhouse: ["townhouse", "single_family"],
  condo: ["condo"],
  multi_family: ["multi_family"],
  manufactured: ["manufactured"],
  land: ["land"],
};

export function compatibleTypes(t: PropertyType): PropertyType[] {
  return COMPATIBLE[t] ?? [t];
}
