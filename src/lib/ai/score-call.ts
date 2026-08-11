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

  const NUDGE =
    "IMPORTANT: Call the score_call tool with every field as NATIVE JSON — " +
    "step_scores and critical_breakpoint as JSON objects, the array fields as " +
    "JSON arrays, and enum/number/string fields as bare values. Do NOT return " +
    "any field as a quoted/escaped JSON string or wrapped in code fences.";

  const attempt = async (temperature: number, nudge: boolean) => {
    const resp = await client().messages.create({
      model: MODEL,
      max_tokens: 32000,
      temperature,
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
      messages: nudge
        ? [
            { role: "user", content: userMessage },
            { role: "user", content: NUDGE },
          ]
        : [{ role: "user", content: userMessage }],
    });

    const toolUse = resp.content.find((c) => c.type === "tool_use") as
      | Anthropic.ToolUseBlock
      | undefined;
    if (!toolUse) throw new Error("No tool_use block in scoring response");

    // If the model hit the output-token ceiling, the tool JSON is truncated and
    // nested objects come back as unparseable strings. Surface that clearly so
    // the caller retries rather than reporting a confusing schema error.
    if (resp.stop_reason === "max_tokens") {
      throw new Error(
        "Scoring response was truncated (hit max output tokens) — retrying"
      );
    }

    // The model intermittently JSON-encodes values that should be native — an
    // object handed back as a string (e.g. step_scores), or even an enum scalar
    // returned quoted (deal_risk: "\"high\""). Recursively decode any string
    // that is itself valid JSON (object, array, or quoted scalar) so validation
    // sees the real shape regardless of which field the model wrapped.
    const deepUnwrap = (val: unknown): unknown => {
      if (typeof val === "string") {
        let s = val.trim();
        if (s.startsWith("```")) {
          s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
        }
        const looksEncoded =
          s.startsWith("{") ||
          s.startsWith("[") ||
          (s.length > 1 && s.startsWith('"') && s.endsWith('"'));
        if (looksEncoded) {
          try {
            return deepUnwrap(JSON.parse(s));
          } catch {
            return val;
          }
        }
        return val;
      }
      if (Array.isArray(val)) return val.map(deepUnwrap);
      if (val && typeof val === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
          out[k] = deepUnwrap(v);
        }
        return out;
      }
      return val;
    };
    const coerced = deepUnwrap(toolUse.input) as Record<string, unknown>;
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

  // First pass is deterministic (temperature 0). If the model produced malformed
  // or mis-encoded output, retrying at temperature 0 would reproduce it verbatim,
  // so subsequent passes raise temperature and add a native-JSON nudge to break
  // the model out of the bad-output rut.
  // Two passes keep the worst case comfortably under the 300s function limit.
  const passes: Array<{ temperature: number; nudge: boolean }> = [
    { temperature: 0, nudge: false },
    { temperature: 0.6, nudge: true },
  ];
  let lastErr: unknown;
  for (const pass of passes) {
    try {
      return await attempt(pass.temperature, pass.nudge);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function round(n: number, places: number) {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}
