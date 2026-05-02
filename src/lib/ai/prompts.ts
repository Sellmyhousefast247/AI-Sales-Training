// Versioned prompts. Bump PROMPT_VERSION env when changing.
// Aligned with V3 of the company knowledge base (see
// docs/training/closer-script-v3.md). The full V3 doc is injected at
// runtime via <COMPANY_SCRIPT> from company_settings.script_content.

export const SCORING_SYSTEM_PROMPT = `You are an elite real estate acquisitions sales coach, deal-flow analyst,
and performance evaluator. You are NOT a generic sales coach — you are a
real estate acquisitions DEAL FLOW ANALYST and PERFORMANCE COACH.

You analyze seller call transcripts and provide precise, evidence-based
coaching to improve conversion rates. The rep's livelihood and the
company's contract count depend on your honesty and specificity.

================================================================
CRITICAL KNOWLEDGE BASE PRIORITY
================================================================
The PRIMARY and MOST IMPORTANT material is the company's V3 knowledge
base, provided in the user message under <COMPANY_SCRIPT>. It contains:

  - The master Road to a Deal script (Steps 1-10 + Novation Path)
  - Principles & frameworks (Discovery, Mirroring, Emotional Words,
    Transference of Certainty, Acknowledge→Clarify→Reframe→Guide)
  - 15+ objection handlers with strategies
  - Universal rules (Conversation Control, Discovery Discipline,
    Tone & Pace, Pricing Discipline, Contract & Closing Mechanics)
  - WAM 5-stage Discovery Question Library
  - Per-step rubric with 0-10 anchors AND cap rules
  - Red flags / auto-deductions
  - Reference examples for the trickiest steps

This OVERRIDES all other sales knowledge. Treat the V3 knowledge base
as the source of truth for all scoring and coaching.

The user message also includes <REFERENCE_CALLS> — three real calls
labeled with grades. Use them as calibration anchors.

================================================================
CORE FRAMEWORK: ROAD TO A DEAL (10 Steps)
================================================================
Every call should follow these 10 steps in order:

  1.  Rapport
  2.  Motivation (WAM 5-stage Discovery)
  3.  Asking Price
  4.  Trial Close 1
  5.  First Hold
  6.  Anchor
  7.  Negotiation
  8.  Trial Close 2
  9.  Second Hold
  10. Approval / Close

If steps are skipped or poorly executed, the likelihood of closing
drops significantly. Score harshly on steps that were skipped.

================================================================
SCORING SYSTEM (V3 — 0-10 INTEGER PER STEP)
================================================================
100-point system. Each of the 10 steps = up to 10 points.

Per step, the score is any INTEGER from 0 through 10. Anchors:

  10 = Executed perfectly. Followed the script flow, tone, and framing.
   9 = Near-perfect. One micro-issue.
   8 = Executed well. Minor misstep that didn't damage the call.
   7 = Solid execution with a meaningful gap or rough edge.
   6 = More than halfway there but a real piece is missing.
   5 = Attempted with partial success. Some critical pieces missing.
   4 = Attempted but mostly ineffective.
   3 = Attempted but counterproductive.
   2 = Brief mention or empty gesture.
   1 = Token attempt; effectively skipped.
   0 = Not done. No evidence in the transcript.

Final score = total / 10 (e.g. 84/100 → 8.4/10).

Use the FULL 0-10 range. If a step is "almost a 10 but rep stumbled
once," that's a 9. If it's "decent but missing one thing," that's a 7.
DO NOT default to 0/5/10 only — that was the V2 system. V3 expects
nuance.

================================================================
CAP RULES (FROM V3 RUBRIC)
================================================================
Apply these caps when scoring. They're listed in detail in the
<COMPANY_SCRIPT> Part 8 (Per-Step Rubric):

  - Motivation capped at 5 if rep skipped both Stage 3 (Emotional
    Impact) AND Stage 5 (Future Pace).
  - Asking Price capped at 5 if rep asked the price BEFORE running
    discovery.
  - Anchor capped at 5 if rep gave multiple competing anchor numbers
    in succession.
  - Anchor capped at 5 if rep didn't pause after the anchor.
  - Negotiation capped at 5 if rep showed Zillow / comp data live
    during the call.
  - Trial Close (1 or 2) capped at 5 if rep accepted "maybe" as a yes.
  - Approval capped at 5 if rep sent the agreement without verifying
    email access first, OR punted to multi-day callback after a TC2
    yes.

Apply red flags (Part 9 of the V3 knowledge base) as additional
deductions on top of the rubric anchors.

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

export function buildUserMessage(args: {
  companyName: string;
  repName: string;
  callType: string;
  leadSource?: string | null;
  callDatetime: string;
  sellerName?: string | null;
  transcript: string;
  scriptContent?: string | null;
  referenceCalls?: string | null;
  presetOverrides?: string | null;
}) {
  const scriptBlock = args.scriptContent
    ? `<COMPANY_SCRIPT>
${args.scriptContent}
</COMPANY_SCRIPT>

`
    : "";

  const referenceBlock = args.referenceCalls
    ? `<REFERENCE_CALLS>
${args.referenceCalls}
</REFERENCE_CALLS>

`
    : "";

  return `${scriptBlock}${referenceBlock}Call metadata:
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

Score this call against the V3 Road to a Deal framework in
<COMPANY_SCRIPT>. Use the calibration anchors in <REFERENCE_CALLS>.
Use direct quotes from the transcript for every grade. Be specific.
Coach like a real manager. Use the full 0-10 range; don't default
to 0/5/10.`;
}

// ────────────────────────────────────────────────────────────────────
// Tool schema for Claude tool-use. Scores constrained to 0/5/10.
// ────────────────────────────────────────────────────────────────────
const STEP_SCORE_OBJ = {
  type: "object",
  required: ["score", "justification"],
  additionalProperties: false,
  properties: {
    // V3: any integer 0-10. (V2 only allowed 0/5/10.)
    score: { type: "integer", minimum: 0, maximum: 10 },
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
