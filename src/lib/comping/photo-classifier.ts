import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { CompCondition, CompRecord, PropertyType } from "./types";

/**
 * Classifies a property's overall condition + property type from
 * listing photos using Claude Haiku's vision capability. Per-comp,
 * parallelized with a soft concurrency cap.
 *
 * When ANTHROPIC_API_KEY is unset (test/CI), falls back to "average"
 * condition + null property type — the orchestrator treats that the
 * same as no signal.
 *
 * Photos are referenced by URL (Claude fetches them server-side). We
 * cap photos per comp to keep token budget predictable.
 */

const MODEL = process.env.ANTHROPIC_MODEL_LIGHT ?? "claude-haiku-4-5-20251001";
const MAX_PHOTOS_PER_COMP = 5;
const CONCURRENCY = 4;

const VISION_PROPERTY_TYPES = [
  "single_family",
  "townhouse",
  "condo",
  "multi_family",
  "manufactured",
  "land",
  "unknown",
] as const;

const tool = {
  name: "classify_property",
  description:
    "Classify the property's overall condition AND its property type " +
    "from listing photos. " +
    "Condition: as_is = needs work, dated finishes, distressed, ugly. " +
    "renovated = recently updated, modern finishes, turnkey. " +
    "average = livable but not updated. " +
    "Property type uses 'unknown' when only interior shots are visible " +
    "and you can't tell from outside.",
  input_schema: {
    type: "object" as const,
    properties: {
      condition: { type: "string", enum: ["as_is", "average", "renovated"] },
      property_type: { type: "string", enum: [...VISION_PROPERTY_TYPES] },
      reason: { type: "string" },
    },
    required: ["condition"],
  },
};

const responseSchema = z.object({
  condition: z.enum(["as_is", "average", "renovated"]),
  property_type: z.enum(VISION_PROPERTY_TYPES).optional(),
  reason: z.string().optional().default(""),
});

const SYSTEM = [
  "You are classifying real-estate listing photos.",
  "Always set `condition` (the overall update level) AND `property_type`",
  "(the structure category) when the photos give enough signal.",
  "",
  "Property-type cues:",
  "  single_family: detached house with own walls; pitched roof, own driveway.",
  "  townhouse: row of attached homes sharing side walls; uniform facade.",
  "  condo: high/mid-rise unit; shared lobby; balcony in a tower.",
  "  multi_family: 2-4 unit building with multiple front doors / mailboxes.",
  "  manufactured: rectangular shape, low-pitch roof, often on piers /",
  "    skirting; double-wide trailer aesthetic.",
  "  land: vacant lot, no structure visible.",
  "  unknown: only interior shots — can't tell from outside.",
].join("\n");

export interface PhotoInput {
  id: string;
  photo_urls: string[];
}

export interface PhotoClassification {
  condition: CompCondition;
  property_type: PropertyType | null;
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  }
  return _client;
}

export async function classifyConditionsFromPhotos(
  inputs: PhotoInput[]
): Promise<Record<string, PhotoClassification>> {
  if (inputs.length === 0) return {};
  if (!process.env.ANTHROPIC_API_KEY) {
    return Object.fromEntries(
      inputs.map((i) => [i.id, { condition: "average" as CompCondition, property_type: null }])
    );
  }

  const out: Record<string, PhotoClassification> = {};
  for (let i = 0; i < inputs.length; i += CONCURRENCY) {
    const slice = inputs.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(slice.map(classifyOne));
    settled.forEach((r, idx) => {
      out[slice[idx].id] =
        r.status === "fulfilled"
          ? r.value
          : { condition: "average", property_type: null };
    });
  }
  return out;
}

async function classifyOne(input: PhotoInput): Promise<PhotoClassification> {
  const photos = input.photo_urls.slice(0, MAX_PHOTOS_PER_COMP);
  if (photos.length === 0) return { condition: "average", property_type: null };

  // Anthropic SDK 0.32.x types don't expose `url`-source images cleanly;
  // we cast to keep the call shape correct for the API.
  const content = [
    {
      type: "text",
      text:
        "Look at these listing photos and classify the property's overall " +
        "condition + property type with the classify_property tool.",
    },
    ...photos.map((url) => ({
      type: "image",
      source: { type: "url", url },
    })),
  ] as unknown as Anthropic.MessageParam["content"];

  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 256,
    temperature: 0,
    system: SYSTEM,
    tools: [tool as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: "classify_property" },
    messages: [{ role: "user", content }],
  });

  const toolUse = resp.content.find((c) => c.type === "tool_use") as
    | Anthropic.ToolUseBlock
    | undefined;
  if (!toolUse) return { condition: "average", property_type: null };

  const parsed = responseSchema.safeParse(toolUse.input);
  if (!parsed.success) return { condition: "average", property_type: null };

  // Treat "unknown" as no signal — caller keeps the provider's value.
  const visionType =
    parsed.data.property_type && parsed.data.property_type !== "unknown"
      ? (parsed.data.property_type as PropertyType)
      : null;

  return { condition: parsed.data.condition, property_type: visionType };
}

/**
 * Apply photo-based classifications back onto a list of comps. Comps
 * without photo_urls or without a stable source_id are passed through
 * unchanged. Vision overrides the provider's `property_type` when it
 * confidently identifies one — provider data is structured but can be
 * wrong or missing for manufactured / multi-family records.
 */
export async function tagCompsByPhotos(
  comps: CompRecord[]
): Promise<CompRecord[]> {
  const inputs: PhotoInput[] = [];
  for (const c of comps) {
    if (c.source_id && c.photo_urls && c.photo_urls.length > 0) {
      inputs.push({ id: c.source_id, photo_urls: c.photo_urls });
    }
  }
  if (inputs.length === 0) return comps;
  const tags = await classifyConditionsFromPhotos(inputs);
  return comps.map((c) => {
    if (!c.source_id) return c;
    const tag = tags[c.source_id];
    if (!tag) return c;
    const next: CompRecord = {
      ...c,
      condition: tag.condition,
      condition_source: "photos",
    };
    if (tag.property_type && tag.property_type !== c.property_type) {
      next.property_type = tag.property_type;
    }
    return next;
  });
}
