import Anthropic from "@anthropic-ai/sdk";
import {
  SCORING_SYSTEM_PROMPT,
  SCORE_CALL_TOOL,
  buildUserMessage,
} from "./prompts";
import { scorecardOutputSchema, type ParsedScorecard } from "./schema";
import { ROAD_TO_DEAL_STEPS } from "@/lib/types";

const MODEL = process.env.ANTHROPIC_MODEL_PRIMARY ?? "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function client() {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return _client;
}

export interface ScoreCallInput {
  companyName: string;
  repName: string;
  callType: string;
  leadSource?: string | null;
  callDatetime: string;
  sellerName?: string | null;
  transcript: string;
  scriptContent?: string | null;
  presetOverrides?: string | null;
}

export interface ScoreCallResult {
  parsed: ParsedScorecard;
  raw: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

const PRICING = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
} as const;

function estimateCost(model: string, input: number, output: number) {
  const p = (PRICING as Record<string, { input: number; output: number }>)[model];
  if (!p) return 0;
  return (input / 1_000_000) * p.input + (output / 1_000_000) * p.output;
}

export async function scoreCall(input: ScoreCallInput): Promise<ScoreCallResult> {
  const userMessage = buildUserMessage(input);

  const attempt = async () => {
    const resp = await client().messages.create({
      model: MODEL,
      max_tokens: 16384,
      temperature: 0,
      // Prompt caching uses a SDK property the 0.32.x types don't yet
      // expose; cast keeps the runtime API call shape correct.
      system: [
        {
          type: "text",
          text: SCORING_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        } as unknown as Anthropic.TextBlockParam,
      ],
      tools: [SCORE_CALL_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: "tool", name: "score_call" },
      messages: [{ role: "user", content: userMessage }],
    });

    const toolUse = resp.content.find((c) => c.type === "tool_use") as
      | Anthropic.ToolUseBlock
      | undefined;
    if (!toolUse) throw new Error("No tool_use block in scoring response");

    // The model occasionally returns a nested field (e.g. step_scores) as a
    // JSON-encoded string instead of an object — unwrap those before parsing.
    const rawInput = toolUse.input as Record<string, unknown>;
    const coerced: Record<string, unknown> = { ...rawInput };
    for (const [k, v] of Object.entries(coerced)) {
      if (typeof v === "string") {
        const s = v.trim();
        if (s.startsWith("{") || s.startsWith("[")) {
          try {
            coerced[k] = JSON.parse(s);
          } catch {
            /* leave as-is; schema will surface the real error */
          }
        }
      }
    }
    const parsed = scorecardOutputSchema.parse(coerced);

    // Authoritative recompute of total + final from individual step scores.
    // The model is instructed to return them but we never trust derived math.
    const sum = ROAD_TO_DEAL_STEPS.reduce(
      (acc, k) => acc + parsed.step_scores[k].score,
      0
    );
    parsed.total_score = sum;
    parsed.final_score = round(sum / 10, 1);

    return {
      parsed,
      raw: toolUse.input,
      model: MODEL,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      costUsd: estimateCost(MODEL, resp.usage.input_tokens, resp.usage.output_tokens),
    } as ScoreCallResult;
  };

  try {
    return await attempt();
  } catch {
    // One retry — most failures are transient schema parse misses
    return await attempt();
  }
}

function round(n: number, places: number) {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}
