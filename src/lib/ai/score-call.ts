import Anthropic from "@anthropic-ai/sdk";
import {
  SCORING_SYSTEM_PROMPT,
  SCORE_CALL_TOOL,
  buildUserMessage,
} from "./prompts";
import { scorecardOutputSchema, type ParsedScorecard } from "./schema";
import { SCORECARD_CATEGORIES } from "@/lib/types";

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
  // Claude Sonnet 4.6 pricing per 1M tokens (USD). Update if pricing changes.
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

  const attempt = async (temperature: number) => {
    const resp = await client().messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature,
      system: [
        {
          type: "text",
          text: SCORING_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [SCORE_CALL_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: "tool", name: "score_call" },
      messages: [{ role: "user", content: userMessage }],
    });

    const toolUse = resp.content.find((c) => c.type === "tool_use") as
      | Anthropic.ToolUseBlock
      | undefined;
    if (!toolUse) throw new Error("No tool_use block in scoring response");

    const parsed = scorecardOutputSchema.parse(toolUse.input);

    // Cross-check totals; recompute if drift > 0.5
    const sum = SCORECARD_CATEGORIES.reduce(
      (acc, k) => acc + parsed.category_scores[k].score,
      0
    );
    const avg = sum / 10;
    if (Math.abs(parsed.total_score - sum) > 0.5) parsed.total_score = round(sum, 2);
    if (Math.abs(parsed.average_score - avg) > 0.05) parsed.average_score = round(avg, 2);

    const inputTokens = resp.usage.input_tokens;
    const outputTokens = resp.usage.output_tokens;
    return {
      parsed,
      raw: toolUse.input,
      model: MODEL,
      inputTokens,
      outputTokens,
      costUsd: estimateCost(MODEL, inputTokens, outputTokens),
    } as ScoreCallResult;
  };

  try {
    return await attempt(0);
  } catch (err) {
    // Retry once at temperature 0 (in case of transient parse/schema fail)
    return await attempt(0);
  }
}

function round(n: number, places: number) {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}
