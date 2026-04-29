import { describe, expect, it } from "vitest";
import { estimateRepairs } from "./repair-estimator";

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
