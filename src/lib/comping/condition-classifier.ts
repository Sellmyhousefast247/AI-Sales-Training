import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { CompCondition, CompRecord } from "./types";

/**
 * Classifies an MLS remark / listing description into one of:
 *   as_is | average | renovated.
 *
 * Used to tag pulled comps so the pipeline can split them into ARV
 * (renovated) and As-Is buckets per the playbook.
 *
 * Skips work entirely when no API key is set (test/CI), returning
 * "average" for every comp — the engine treats that as the as_is bucket
 * but warns about low confidence in the output.
 */

const MODEL = process.env.ANTHROPIC_MODEL_LIGHT ?? "claude-haiku-4-5-20251001";

const classifyTool: Anthropic.Tool = {
  name: "classify_conditions",
  description:
    "Classify each listing remark as one of: as_is, average, renovated. " +
    "as_is = needs work, distressed, dated, ugly. " +
    "renovated = recently updated/remodeled, turnkey, new finishes. " +
    "average = livable but not updated.",
  input_schema: {
    type: "object",
    properties: {
      classifications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            condition: { type: "string", enum: ["as_is", "average", "renovated"] },
            reason: { type: "string" },
          },
          required: ["id", "condition"],
        },
      },
    },
    required: ["classifications"],
  },
};

const responseSchema = z.object({
  classifications: z.array(
    z.object({
      id: z.string(),
      condition: z.enum(["as_is", "average", "renovated"]),
      reason: z.string().optional().default(""),
    })
  ),
});

interface RemarkInput {
  id: string;
  text: string;
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  }
  return _client;
}

export async function classifyConditions(
  remarks: RemarkInput[]
): Promise<Record<string, CompCondition>> {
  if (remarks.length === 0) return {};
  if (!process.env.ANTHROPIC_API_KEY) {
    return Object.fromEntries(remarks.map((r) => [r.id, "average" as CompCondition]));
  }

  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0,
    tools: [classifyTool],
    tool_choice: { type: "tool", name: "classify_conditions" },
    messages: [
      {
        role: "user",
        content:
          "Classify each listing remark below.\n\n" +
          remarks
            .map((r) => `id=${r.id}\nremark: ${r.text.slice(0, 800)}\n---`)
            .join("\n"),
      },
    ],
  });

  const toolUse = resp.content.find((c) => c.type === "tool_use") as
    | Anthropic.ToolUseBlock
    | undefined;
  if (!toolUse) {
    return Object.fromEntries(remarks.map((r) => [r.id, "average" as CompCondition]));
  }

  const parsed = responseSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return Object.fromEntries(remarks.map((r) => [r.id, "average" as CompCondition]));
  }

  const map: Record<string, CompCondition> = {};
  for (const c of parsed.data.classifications) {
    map[c.id] = c.condition;
  }
  // Anything the model dropped → average.
  for (const r of remarks) {
    if (!(r.id in map)) map[r.id] = "average";
  }
  return map;
}

/**
 * Apply classified conditions back onto comp records, using a stable id.
 * If a comp doesn't have remarks, its existing condition is preserved.
 */
export async function tagCompConditions(
  comps: CompRecord[],
  remarksById: Record<string, string>
): Promise<CompRecord[]> {
  const inputs: RemarkInput[] = Object.entries(remarksById).map(([id, text]) => ({
    id,
    text,
  }));
  const classifications = await classifyConditions(inputs);
  return comps.map((c) => {
    const id = c.source_id ?? "";
    const tagged = classifications[id];
    return tagged ? { ...c, condition: tagged } : c;
  });
}
