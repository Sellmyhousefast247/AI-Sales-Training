import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { CompCondition, CompRecord } from "./types";

/**
 * Classifies a property's overall condition from listing photos using
 * Claude Haiku's vision capability. Per-comp, parallelized with a soft
 * concurrency cap.
 *
 * When ANTHROPIC_API_KEY is unset (test/CI), falls back to "average"
 * for every input — the orchestrator treats that the same as no signal.
 *
 * Photos are referenced by URL (Claude fetches them server-side). We
 * cap photos per comp to keep token budget predictable.
 */

const MODEL = process.env.ANTHROPIC_MODEL_LIGHT ?? "claude-haiku-4-5-20251001";
const MAX_PHOTOS_PER_COMP = 5;
const CONCURRENCY = 4;

const tool = {
  name: "classify_condition",
  description:
    "Classify the property's overall condition from listing photos. " +
    "as_is = needs work, dated finishes, distressed, ugly. " +
    "renovated = recently updated, modern finishes, turnkey. " +
    "average = livable but not updated.",
  input_schema: {
    type: "object" as const,
    properties: {
      condition: { type: "string", enum: ["as_is", "average", "renovated"] },
      reason: { type: "string" },
    },
    required: ["condition"],
  },
};

const responseSchema = z.object({
  condition: z.enum(["as_is", "average", "renovated"]),
  reason: z.string().optional().default(""),
});

export interface PhotoInput {
  id: string;
  photo_urls: string[];
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
): Promise<Record<string, CompCondition>> {
  if (inputs.length === 0) return {};
  if (!process.env.ANTHROPIC_API_KEY) {
    return Object.fromEntries(inputs.map((i) => [i.id, "average" as CompCondition]));
  }

  const out: Record<string, CompCondition> = {};
  for (let i = 0; i < inputs.length; i += CONCURRENCY) {
    const slice = inputs.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(slice.map(classifyOne));
    settled.forEach((r, idx) => {
      out[slice[idx].id] = r.status === "fulfilled" ? r.value : "average";
    });
  }
  return out;
}

async function classifyOne(input: PhotoInput): Promise<CompCondition> {
  const photos = input.photo_urls.slice(0, MAX_PHOTOS_PER_COMP);
  if (photos.length === 0) return "average";

  // Anthropic SDK 0.32.x types don't expose `url`-source images cleanly;
  // we cast to keep the call shape correct for the API.
  const content = [
    {
      type: "text",
      text:
        "Look at these listing photos and classify the property's overall " +
        "condition with the classify_condition tool.",
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
    tools: [tool as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: "classify_condition" },
    messages: [{ role: "user", content }],
  });

  const toolUse = resp.content.find((c) => c.type === "tool_use") as
    | Anthropic.ToolUseBlock
    | undefined;
  if (!toolUse) return "average";

  const parsed = responseSchema.safeParse(toolUse.input);
  return parsed.success ? parsed.data.condition : "average";
}

/**
 * Apply photo-based classifications back onto a list of comps. Comps
 * without photo_urls or without a stable source_id are passed through
 * unchanged.
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
    return tag ? { ...c, condition: tag } : c;
  });
}
