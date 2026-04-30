import { describe, expect, it } from "vitest";
import {
  compatibleTypes,
  detectPropertyType,
  detectPropertyTypeOrDefault,
  isStrictPropertyType,
} from "./property-type";

describe("detectPropertyType", () => {
  it.each([
    ["Single Family Residence", "single_family"],
    ["SFR", "single_family"],
    ["DETACHED", "single_family"],
    ["Townhouse", "townhouse"],
    ["Town home", "townhouse"],
    ["Condominium", "condo"],
    ["CONDO", "condo"],
    ["Duplex", "multi_family"],
    ["Triplex", "multi_family"],
    ["fourplex", "multi_family"],
    ["Multi-Family", "multi_family"],
    ["Multi Unit", "multi_family"],
    ["2-4 units", "multi_family"],
    ["Manufactured Home", "manufactured"],
    ["Mobile Home", "manufactured"],
    ["Trailer", "manufactured"],
    ["MH Park", "manufactured"],
    ["Vacant Land", "land"],
    ["Raw Land", "land"],
  ] as const)("classifies %s as %s", (input, expected) => {
    expect(detectPropertyType(input)).toBe(expected);
  });

  it("returns null when nothing matches", () => {
    expect(detectPropertyType(undefined)).toBeNull();
    expect(detectPropertyType("")).toBeNull();
    expect(detectPropertyType("Commercial Office Building")).toBeNull();
  });

  it("prefers more specific patterns when both could match", () => {
    // "Single Family Manufactured Home" should classify as manufactured,
    // not single_family — manufactured pattern is checked first.
    expect(detectPropertyType("Single Family Manufactured Home")).toBe("manufactured");
  });
});

describe("detectPropertyTypeOrDefault", () => {
  it("returns single_family for unknown blobs", () => {
    expect(detectPropertyTypeOrDefault("Office Building")).toBe("single_family");
    expect(detectPropertyTypeOrDefault(undefined)).toBe("single_family");
  });

  it("preserves a confident match", () => {
    expect(detectPropertyTypeOrDefault("Manufactured Home")).toBe("manufactured");
  });
});

describe("isStrictPropertyType", () => {
  it.each(["manufactured", "multi_family", "land"] as const)("flags %s as strict", (t) => {
    expect(isStrictPropertyType(t)).toBe(true);
  });

  it.each(["single_family", "townhouse", "condo"] as const)(
    "does not flag %s as strict",
    (t) => {
      expect(isStrictPropertyType(t)).toBe(false);
    }
  );
});

describe("compatibleTypes", () => {
  it("groups SFR and townhouse together", () => {
    expect(compatibleTypes("single_family")).toContain("townhouse");
    expect(compatibleTypes("townhouse")).toContain("single_family");
  });

  it("keeps condo to itself (HOA dynamics)", () => {
    expect(compatibleTypes("condo")).toEqual(["condo"]);
  });

  it("keeps strict types to themselves", () => {
    expect(compatibleTypes("manufactured")).toEqual(["manufactured"]);
    expect(compatibleTypes("multi_family")).toEqual(["multi_family"]);
    expect(compatibleTypes("land")).toEqual(["land"]);
  });
});
