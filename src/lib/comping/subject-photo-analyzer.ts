import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { CompCondition, PropertyType } from "./types";

/**
 * Analyzes a subject property's listing photos and returns:
 *   - overall condition (as_is | average | renovated)
 *   - a `condition_text` string formatted to drive the keyword-based
 *     repair estimator (comma-separated drivers + a brief summary)
 *   - structured `drivers` for UI display
 *   - property_type best-guess (so the form can warn when the user's
 *     selection disagrees with what the photos actually show)
 *
 * Used by the calculator form to pre-fill the condition box from a
 * pasted list of photo URLs. The user reviews/edits before submitting.
 */

const VISION_PROPERTY_TYPES = [
  "single_family",
  "townhouse",
  "condo",
  "multi_family",
  "manufactured",
  "land",
  "unknown",
] as const;

const MODEL = process.env.ANTHROPIC_MODEL_LIGHT ?? "claude-haiku-4-5-20251001";
const MAX_PHOTOS = 8;

const tool = {
  name: "analyze_subject",
  description:
    "Inspect the listing photos of a property and report its overall " +
    "condition plus a condition_text string suitable for a repair " +
    "estimator. The condition_text MUST be a short comma-separated " +
    "list of repair drivers using the project's vocabulary (e.g. " +
    "\"roof damage, outdated kitchen, foundation cracks, full rehab\").",
  input_schema: {
    type: "object" as const,
    properties: {
      condition: { type: "string", enum: ["as_is", "average", "renovated"] },
      condition_text: { type: "string" },
      drivers: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
      property_type: {
        type: "string",
        enum: [...VISION_PROPERTY_TYPES],
        description:
          "Best guess of the property type from the photos. Use 'unknown' " +
          "if you only see interior shots or otherwise can't tell.",
      },
    },
    required: ["condition", "condition_text", "drivers"],
  },
};

const responseSchema = z.object({
  condition: z.enum(["as_is", "average", "renovated"]),
  condition_text: z.string(),
  drivers: z.array(z.string()).default([]),
  summary: z.string().optional().default(""),
  property_type: z.enum(VISION_PROPERTY_TYPES).optional(),
});

export interface SubjectPhotoAnalysis {
  condition: CompCondition;
  condition_text: string;
  drivers: string[];
  summary: string;
  /** Vision's best guess of the property type. null when not sure or unknown. */
  property_type: PropertyType | null;
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  }
  return _client;
}

const SYSTEM = [
  "You are a real-estate rehab assessor.",
  "Look at the listing photos and decide the property's overall condition.",
  "as_is = needs work, dated finishes, distressed, ugly.",
  "renovated = recently updated, modern finishes, turnkey.",
  "average = livable but not updated.",
  "",
  "When producing condition_text, use the EXACT vocabulary the project's",
  "repair estimator looks for. Pick from these phrases when applicable:",
  "  Light: paint, carpet, cosmetic, minor, clean out, fixtures",
  "  Moderate: kitchen update, bathroom update, flooring, hvac service,",
  "    minor roof, water heater, electrical update, plumbing update,",
  "    outdated kitchen, outdated bath, dated",
  "  Heavy: full kitchen, full bath, roof replacement, new roof, roof",
  "    damage, hvac replace, new hvac, windows, siding, rewire, repipe",
  "  Full Gut: gut, down to studs, foundation, structural, fire damage,",
  "    mold, water damage, addition, full rehab, complete rehab",
  "",
  "If you only see exterior or partial photos, say so in the summary",
  "and stick to the conservative end of what you can verify.",
  "",
  "For property_type, use these visual cues:",
  "  single_family: a detached house on its own lot; pitched roof, own walls.",
  "  townhouse: row of attached homes sharing side walls; uniform facade.",
  "  condo: high/mid-rise unit; shared lobby, balcony in a tower.",
  "  multi_family: 2-4 unit building with multiple front doors / mailboxes.",
  "  manufactured: rectangular shape, low-pitch roof, often on piers /",
  "    skirting; double-wide trailer aesthetic.",
  "  land: vacant lot, no structure visible.",
  "  unknown: only interior shots — can't tell from outside.",
].join("\n");

export async function analyzeSubjectPhotos(
  photoUrls: string[]
): Promise<SubjectPhotoAnalysis> {
  const photos = photoUrls.filter(Boolean).slice(0, MAX_PHOTOS);
  if (photos.length === 0) {
    return {
      condition: "average",
      condition_text: "",
      drivers: [],
      summary: "",
      property_type: null,
    };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      condition: "average",
      condition_text: "",
      drivers: [],
      summary: "Vision skipped — ANTHROPIC_API_KEY not configured.",
      property_type: null,
    };
  }

  // SDK 0.32.x types do not yet expose `url`-source images cleanly.
  const content = [
    {
      type: "text",
      text: "Analyze these listing photos and call analyze_subject with the result.",
    },
    ...photos.map((url) => ({ type: "image", source: { type: "url", url } })),
  ] as unknown as Anthropic.MessageParam["content"];

  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 512,
    temperature: 0,
    system: SYSTEM,
    tools: [tool as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: "analyze_subject" },
    messages: [{ role: "user", content }],
  });

  const toolUse = resp.content.find((c) => c.type === "tool_use") as
    | Anthropic.ToolUseBlock
    | undefined;
  const empty = {
    condition: "average" as CompCondition,
    condition_text: "",
    drivers: [] as string[],
    summary: "",
    property_type: null,
  };
  if (!toolUse) return empty;

  const parsed = responseSchema.safeParse(toolUse.input);
  if (!parsed.success) return empty;

  // Treat "unknown" the same as no answer so the form doesn't trigger
  // a mismatch warning when vision wasn't sure.
  const visionType =
    parsed.data.property_type && parsed.data.property_type !== "unknown"
      ? (parsed.data.property_type as PropertyType)
      : null;

  return {
    condition: parsed.data.condition,
    condition_text: parsed.data.condition_text.trim(),
    drivers: parsed.data.drivers,
    summary: parsed.data.summary,
    property_type: visionType,
  };
}
