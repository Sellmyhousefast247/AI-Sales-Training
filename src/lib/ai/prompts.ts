// Versioned prompts. Bump PROMPT_VERSION env when changing.
// Aligned with the "2026 ACQ Closer Manual V3.8" — Road to a Deal framework.

export const SCORING_SYSTEM_PROMPT = `You are an elite real estate acquisitions sales coach, deal-flow analyst,
and performance evaluator. You are NOT a generic sales coach — you are a
real estate acquisitions DEAL FLOW ANALYST and PERFORMANCE COACH.

You analyze seller call transcripts and provide precise, evidence-based
coaching to improve conversion rates. The rep's livelihood and the
company's contract count depend on your honesty and specificity.

================================================================
CRITICAL KNOWLEDGE BASE PRIORITY
================================================================
The PRIMARY and MOST IMPORTANT script is:

  "2026 ACQ CLOSER MANUAL V3.8"

This document defines:
  - The official company script
  - The exact call structure
  - The "Road to a Deal" framework

This OVERRIDES all other sales knowledge. All evaluations must align
with this system and its flow. When the manual is provided in the
user message under <COMPANY_SCRIPT>, treat it as the source of truth.
If the manual is not provided, fall back to the Road to a Deal
framework defined below.

================================================================
CORE FRAMEWORK: ROAD TO A DEAL
================================================================
Every call MUST follow these 10 steps in order:

  1.  Rapport
  2.  Motivation (Why / Condition / Timeline)
  3.  Get Asking Price
  4.  Trial Close 1
  5.  First Hold
  6.  Anchor
  7.  Negotiation
  8.  Trial Close 2
  9.  Second Hold
  10. Approval / Close

If steps are skipped or poorly executed, the likelihood of closing
drops significantly. Score harshly on steps that were skipped — a
"5" is for a real attempt, not for a quick mention in passing.

================================================================
SCORING SYSTEM (CRITICAL)
================================================================
100-point system. Each of the 10 steps = 10 points.

Per step, the only allowed scores are:
  0  = Not done
  5  = Attempted but weak
  10 = Executed correctly

Final score = total / 10 (e.g. 84/100 → 8.4/10).

Do NOT use intermediate values like 3, 7, or 8. The system rejects
anything other than 0, 5, or 10.

================================================================
QUOTE-BASED ANALYSIS (MANDATORY)
================================================================
Every weakness, every breakdown, every "what was done well" callout
MUST cite a direct quote from the transcript. If you cannot find a
quote, the moment didn't happen — score it 0.

Never invent quotes. If the transcript is too short or unclear to
judge a step, score 0 (not done) and note "no evidence in transcript".

================================================================
COACHING METHOD (MANDATORY)
================================================================
For every major weakness in "areas_for_improvement", use this exact
structure:

  rep_said:          The exact quote from the rep
  issue:             Why it was ineffective per Road to a Deal / script
  better_approach:   What they should have done
  corrected_script:  Improved version in company tone and structure

Coach in the voice of a real sales manager actively training the rep.
Direct. Specific. No corporate fluff.

================================================================
CRITICAL BREAKPOINT (MANDATORY)
================================================================
Identify the FIRST major breakdown in the call:
  - quote:                       Exact quote where it happened
  - step_failed:                 Which Road to a Deal step failed
  - why_it_caused_loss:          Why the deal was weakened or lost
  - what_should_have_happened:   What the right move looked like

If the call had no major breakdown, set quote to the weakest moment,
step_failed to the lowest-scored step, and explain accordingly.

================================================================
IMPROVED CALL FLOW SUMMARY
================================================================
Briefly explain how the call SHOULD have gone using the correct
Road to a Deal structure. 4–8 sentences. Walk through the steps
that the rep skipped or fumbled and show the cleaner path.

================================================================
PRACTICAL OUTPUT FIELDS
================================================================
Also produce these fields for downstream use:
  - suggested_followup_sms:     1–2 sentences. Casual. Reference call detail.
  - suggested_followup_email:   Longer. Reference seller pain. Soft CTA.
  - coaching_notes_manager:     What the manager should drill this week.
  - coaching_notes_rep:         Same content, encouraging-but-honest voice.
                                Lead with one strength before the fix.
  - deal_risk:                  low | medium | high
  - conversion_probability:     0–100 integer
  - recommended_next_action:    One sentence

================================================================
OUTPUT
================================================================
You output a single JSON object using the score_call tool.
Do not output anything else. Do not output prose outside the tool.`;

/**
 * The company reference script as its own system block, so score-call can mark
 * it with cache_control. It is the largest constant chunk of every scoring
 * request (~15k tokens for the V4 script) and identical call-to-call.
 */
export function buildScriptSystemBlock(scriptContent: string): string {
  return `The company's reference sales script and knowledge base. When grading, treat it as the source of truth for what the rep SHOULD have said and done:

<COMPANY_SCRIPT>
${scriptContent}
</COMPANY_SCRIPT>`;
}

export function buildUserMessage(args: {
  companyName: string;
  repName: string;
  callType: string;
  leadSource?: string | null;
  callDatetime: string;
  sellerName?: string | null;
  transcript: string;
  scriptContent?: string | null;
  presetOverrides?: string | null;
}) {
  // NOTE: the company script is NOT embedded here anymore — it rides as a
  // prompt-cached system block (see buildScriptSystemBlock) so its ~15k tokens
  // are billed at 10% on cache hits instead of full price on every score.
  return `Call metadata:
- Company: ${args.companyName}
- Rep: ${args.repName}
- Call type: ${args.callType}
- Lead source: ${args.leadSource ?? "(not provided)"}
- Date: ${args.callDatetime}
- Seller: ${args.sellerName ?? "unknown"}

${args.presetOverrides ? `Company-specific scorecard adjustments:\n${args.presetOverrides}\n\n` : ""}Transcript:
"""
${args.transcript}
"""

IMPORTANT — speaker labels: the REP/SELLER labels come from automatic
speaker diarization and are sometimes SWAPPED. Before scoring, determine
from context which speaker actually works for ${args.companyName} (the
one making offers, referencing the company, following the acquisition
script) and grade THAT person as the rep, regardless of the printed
labels. If the labels appear swapped, say so in coaching_notes_manager
and grade the true rep's performance.

Score this call against the Road to a Deal framework. Use direct
quotes from the transcript. Be specific. Coach like a real manager.`;
}

// ────────────────────────────────────────────────────────────────────
// Tool schema for Claude tool-use. Scores constrained to 0/5/10.
// ────────────────────────────────────────────────────────────────────
const STEP_SCORE_OBJ = {
  type: "object",
  required: ["score", "justification"],
  additionalProperties: false,
  properties: {
    score: { type: "integer", enum: [0, 5, 10] },
    justification: { type: "string" },
    supporting_quote: { type: "string" },
  },
} as const;

export const SCORE_CALL_TOOL = {
  name: "score_call",
  description:
    "Submit the structured Road to a Deal scorecard for this seller call.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    required: [
      "step_scores",
      "total_score",
      "final_score",
      "critical_breakpoint",
      "what_was_done_well",
      "areas_for_improvement",
      "missed_opportunities",
      "improved_call_flow_summary",
      "suggested_followup_sms",
      "suggested_followup_email",
      "coaching_notes_manager",
      "coaching_notes_rep",
      "deal_risk",
      "conversion_probability",
      "recommended_next_action",
    ],
    properties: {
      step_scores: {
        type: "object",
        additionalProperties: false,
        required: [
          "rapport",
          "motivation",
          "asking_price",
          "trial_close_1",
          "first_hold",
          "anchor",
          "negotiation",
          "trial_close_2",
          "second_hold",
          "approval_close",
        ],
        properties: {
          rapport:        STEP_SCORE_OBJ,
          motivation:     STEP_SCORE_OBJ,
          asking_price:   STEP_SCORE_OBJ,
          trial_close_1:  STEP_SCORE_OBJ,
          first_hold:     STEP_SCORE_OBJ,
          anchor:         STEP_SCORE_OBJ,
          negotiation:    STEP_SCORE_OBJ,
          trial_close_2:  STEP_SCORE_OBJ,
          second_hold:    STEP_SCORE_OBJ,
          approval_close: STEP_SCORE_OBJ,
        },
      },
      total_score: { type: "integer", minimum: 0, maximum: 100 },
      final_score: { type: "number", minimum: 0, maximum: 10 },
      critical_breakpoint: {
        type: "object",
        additionalProperties: false,
        required: ["quote", "step_failed", "why_it_caused_loss", "what_should_have_happened"],
        properties: {
          quote: { type: "string" },
          step_failed: {
            type: "string",
            enum: [
              "rapport","motivation","asking_price","trial_close_1","first_hold",
              "anchor","negotiation","trial_close_2","second_hold","approval_close",
            ],
          },
          why_it_caused_loss: { type: "string" },
          what_should_have_happened: { type: "string" },
        },
      },
      what_was_done_well: { type: "string" },
      areas_for_improvement: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["rep_said", "issue", "better_approach", "corrected_script"],
          properties: {
            rep_said: { type: "string" },
            issue: { type: "string" },
            better_approach: { type: "string" },
            corrected_script: { type: "string" },
            step: {
              type: "string",
              enum: [
                "rapport","motivation","asking_price","trial_close_1","first_hold",
                "anchor","negotiation","trial_close_2","second_hold","approval_close",
              ],
            },
          },
        },
      },
      missed_opportunities: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["what_was_missed", "fix"],
          properties: {
            rep_said: { type: "string" },
            what_was_missed: { type: "string" },
            fix: { type: "string" },
          },
        },
      },
      improved_call_flow_summary: { type: "string" },
      suggested_followup_sms: { type: "string" },
      suggested_followup_email: { type: "string" },
      coaching_notes_manager: { type: "string" },
      coaching_notes_rep: { type: "string" },
      deal_risk: { type: "string", enum: ["low", "medium", "high"] },
      conversion_probability: { type: "integer", minimum: 0, maximum: 100 },
      recommended_next_action: { type: "string" },
    },
  },
} as const;
