import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeSubjectPhotos } from "./subject-photo-analyzer";

let savedKey: string | undefined;
beforeAll(() => {
  savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => {
  if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
});

describe("analyzeSubjectPhotos", () => {
  it("returns an empty result when no URLs are provided", async () => {
    const out = await analyzeSubjectPhotos([]);
    expect(out).toEqual({
      condition: "average",
      condition_text: "",
      drivers: [],
      summary: "",
      property_type: null,
    });
  });

  it("filters out empty strings before counting photos", async () => {
    const out = await analyzeSubjectPhotos(["", "", ""]);
    // All inputs are falsy → filtered out → length 0 → empty path (no
    // 'Vision skipped' message because we never reached the API key check).
    expect(out).toEqual({
      condition: "average",
      condition_text: "",
      drivers: [],
      summary: "",
      property_type: null,
    });
  });

  it("falls back gracefully when no API key is set, without throwing", async () => {
    const out = await analyzeSubjectPhotos(["https://example.com/p1.jpg"]);
    expect(out.condition).toBe("average");
    expect(out.condition_text).toBe("");
    expect(out.summary).toMatch(/Vision skipped/i);
    expect(out.property_type).toBeNull();
  });
});
