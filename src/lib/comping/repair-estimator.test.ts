import { describe, expect, it } from "vitest";
import { detectRepairLevel, estimateRepairs } from "./repair-estimator";

describe("estimateRepairs", () => {
  it("treats the example prompt as Full Gut due to foundation+full rehab", () => {
    const r = estimateRepairs(
      1500,
      "Needs full rehab, roof damage, outdated kitchen, foundation cracks"
    );
    expect(r.level).toBe("Full Gut");
    expect(r.low).toBe(1500 * 55);
    expect(r.high).toBe(1500 * 85);
    expect(r.drivers.length).toBeGreaterThan(0);
  });

  it("classifies cosmetic-only as Light", () => {
    const r = estimateRepairs(1200, "Just needs paint, carpet, and a deep clean.");
    expect(r.level).toBe("Light");
  });

  it("classifies kitchen+bath update as Moderate", () => {
    const r = estimateRepairs(1400, "Needs kitchen update and bathroom update, dated finishes.");
    expect(r.level).toBe("Moderate");
  });

  it("classifies new roof + windows + siding as Heavy", () => {
    const r = estimateRepairs(1800, "Needs new roof, windows, and siding.");
    expect(r.level).toBe("Heavy");
  });

  it("escalates to Full Gut on mold", () => {
    const r = estimateRepairs(1000, "Some mold in the basement, otherwise paint only.");
    expect(r.level).toBe("Full Gut");
  });

  it("escalates to Heavy when 4+ major systems are flagged", () => {
    const r = estimateRepairs(
      1600,
      "Roof, HVAC, kitchen, bathroom and electrical all need attention."
    );
    expect(["Heavy", "Full Gut"]).toContain(r.level);
  });

  it("returns a Light minimum when the text is empty", () => {
    const r = estimateRepairs(1500, "");
    expect(r.level).toBe("Light");
    expect(r.point).toBeGreaterThan(0);
  });
});

describe("estimateRepairs override", () => {
  it("uses the override level when provided", () => {
    const r = estimateRepairs(1500, "paint and carpet only", "Heavy");
    expect(r.level).toBe("Heavy");
    expect(r.cost_per_sqft.low).toBe(35);
    expect(r.cost_per_sqft.high).toBe(55);
    expect(r.low).toBe(1500 * 35);
    expect(r.high).toBe(1500 * 55);
  });

  it("flags override_used when override differs from auto-detected level", () => {
    const r = estimateRepairs(1500, "paint and carpet only", "Heavy");
    expect(r.auto_level).toBe("Light");
    expect(r.override_used).toBe(true);
  });

  it("does not flag override_used when override matches auto", () => {
    const r = estimateRepairs(1500, "needs new roof, full kitchen, full bath", "Heavy");
    expect(r.auto_level).toBe("Heavy");
    expect(r.override_used).toBe(false);
  });

  it("auto_level + override_used=false when no override is given", () => {
    const r = estimateRepairs(1500, "paint and carpet only");
    expect(r.level).toBe("Light");
    expect(r.auto_level).toBe("Light");
    expect(r.override_used).toBe(false);
  });
});

describe("detectRepairLevel", () => {
  it("flags empty=true when no keywords match", () => {
    expect(detectRepairLevel("").empty).toBe(true);
    expect(detectRepairLevel("seller is motivated, needs to close fast").empty).toBe(true);
  });

  it("flags empty=false when keywords match", () => {
    expect(detectRepairLevel("outdated kitchen").empty).toBe(false);
  });

  it("returns matching drivers for inspection", () => {
    const out = detectRepairLevel("roof damage and outdated kitchen");
    expect(out.drivers).toContain("roof damage");
    expect(out.drivers).toContain("outdated kitchen");
  });
});
