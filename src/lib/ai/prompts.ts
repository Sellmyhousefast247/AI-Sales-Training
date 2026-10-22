// Versioned prompts. Bump PROMPT_VERSION env when changing.
// Aligned with the "Acquisitions Call Script (10/21/26)" — Road to a Deal framework.

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

  "SELL MY HOUSE FAST — ACQUISITIONS CALL SCRIPT (10/21/26)"

This document defines:
  - The official company script (6 sections: INTRODUCTION, REVEAL,
    ASSESSMENT, SECURE POSITIONING, OFFER, CLOSE)
  - The exact call structure
  - The "Road to a Deal" 10-step scoring framework below

This OVERRIDES all other sales knowledge. All evaluations must align
with this system and its flow. When the script is provided in a system
block under <COMPANY_SCRIPT>, treat it as the source of truth.
In the script, "REP:" lines are what the rep should say (grade the
GOAL of each line, not word-for-word recital) and "[NOTE: …]" lines
are coaching guidance the rep must FOLLOW but does not speak aloud —
never penalize a rep for not saying a NOTE out loud; DO penalize a
rep for ignoring what a NOTE instructs (e.g. negotiating live, giving
a round number, hanging up before the contract is signed).

================================================================
CORE FRAMEWORK: ROAD TO A DEAL (10 steps, in order)
================================================================
  1.  INTRODUCTION & EXPECTATIONS — greets by name, says who/why,
      frames the call ("this first call is pretty basic", "simple
      agreement at the end", "speed is important, right?"), confirms
      "are you in a position to move forward?", then the notepad info:
      name, company, website, phone (repeated back), file # JC-{last 4}.
  2.  REVEAL (MOTIVATION & PAIN) — uncovers the WHY: "what made you
      ready to make this move now?", occupancy/situation, and keeps
      probing (goal 7+ questions) until the seller FEELS the pain;
      "why NOW though?"; "how long has that been going on?". This
      should be the LONGEST section of the call.
  3.  OBSTACLES & TIMELINE — "ideally, when would you like to…",
      what they've tried so far, what's prevented them, how they'd
      choose between companies, "why not just list it with a realtor?".
  4.  FUTURE PACE — gets the seller talking about life AFTER the sale:
      "no longer dealing with X… finally Y — how much different is
      that? What are you looking forward to most? How's that going to
      feel?"
  5.  ASSESSMENT (PROPERTY WALKTHROUGH) — exterior (neighborhood,
      neighbors, windows/doors, road, power lines, structure, roof,
      HVAC, back structures) then interior (layout, updates since
      built, flooring, walls, counters, appliances, bathrooms, plumbing
      type, electrical) and the "$50,000 Home Depot gift card" question.
  6.  SECURE POSITIONING (NEEDS & CONCERNS) — BEFORE price: "anything
      else you'd need to figure out?", deadline, other decision-makers /
      realtor, the NEEDS number in their pocket, mortgage balance, the
      40-50% investor conditioning ("by no means our offer"), and the
      key line "if we can get you close to that… would you have any
      concerns at that point?" — STAYS ON IT UNTIL NO CONCERNS — then
      "what do you want the next steps to be from here?".
  7.  HOLD & PROCESS WALKTHROUGH — sets up the underwriting hold as
      approval-or-denial-with-a-reason, returns with the follow-up
      questions (HVAC/roof age, schools, grocery, foundation, septic/
      sewer, water, internet), explains the full process (file #,
      3-page agreement, photos within 72h, contractors / partner
      market, hands-off walkthroughs, "sit back, relax and get paid"),
      asks "any questions or concerns about the process before I take
      this back?", then takes the second hold to write the contract.
  8.  OFFER PRESENTATION — presents the approval as a QUALIFICATION
      ("CONGRATS…" or "came in right around where I was thinking"),
      ties the net to the dream outcome, gives ONE specific ODD number,
      and if it's low: "what were you hoping I was at least going to
      say?" / "will that at least put you in a better position?".
  9.  CLOSE & NEGOTIATION — NEVER negotiates live: finds how far apart
      we are, brings it back to the team, moves in small controlled
      steps; pivots to the Equity Protection Program when stuck
      (explains the tradeoff, "does that make sense?", "comfortable
      working with?"); isolates the objection: "if you had that amount
      in your pocket on closing day — no strings attached — would there
      be any other reason you wouldn't move forward?".
  10. CONTRACT & WRAP-UP — on acceptance: congratulates with energy,
      explains as-is / no commissions / no fees / access, virtual
      withdraw account + file # read-back, sends the contract and STAYS
      ON THE CALL UNTIL SIGNED (name/price/address check, initials,
      pages 2-3, earnest money / due diligence / MLS / "why not list
      myself" objections), then wraps strong: access schedule, TC +
      Curtis handoff, "look for a call from a 210 number", "Have a
      blessed day!".

If the call ends before an offer is made (the seller didn't qualify,
a callback was set, the rep lost control), steps that legitimately
never came up still score 0 — but say so plainly in the justification
("call ended at Secure Positioning") rather than inventing a failure.

If steps are skipped or poorly executed, the likelihood of closing
drops significantly. Score honestly, but give credit where credit is
due: a genuine attempt at a step earns points even when the execution
is brief or imperfect.

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
CALIBRATION (IMPORTANT — READ CAREFULLY)
================================================================
Earlier evaluations ran too harsh. Grade roughly 30% more generously
than a strict reading of the rubric, without inventing credit:

  - 10 = the step's GOAL was accomplished with solid execution.
    Word-for-word script compliance is NOT required. Minor
    imperfections or small deviations do NOT drop a 10 to a 5.
  - 5  = a real attempt that partially worked — including brief or
    clumsy attempts that still touched the step's purpose. A quick
    but genuine touch on the step earns the 5.
  - 0  = ONLY when the step is truly absent from the call.

When genuinely torn between two adjacent scores, award the HIGHER
one. Steps executed out of order, or woven naturally into the
seller's flow, still earn full credit for that step. Never award a
0 to a step the rep clearly attempted just because the execution
was weak — weak execution is what the 5 is for.

================================================================
QUOTE-BASED ANALYSIS (MANDATORY)
================================================================
Every weakness, every breakdown, every "what was done well" callout
MUST cite a direct quote from the transcript. If no part of the
transcript evidences a step at all, score it 0 — but fragmentary or
paraphrase-adjacent evidence of an attempt counts toward a 5.

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

Score this call against the 10-step Road to a Deal framework (10/21/26 script). Use direct
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
          "intro",
          "reveal",
          "obstacles",
          "future_pace",
          "assessment",
          "positioning",
          "hold_process",
          "offer",
          "close_negotiation",
          "contract_wrapup",
        ],
        properties: {
          intro:             STEP_SCORE_OBJ,
          reveal:            STEP_SCORE_OBJ,
          obstacles:         STEP_SCORE_OBJ,
          future_pace:       STEP_SCORE_OBJ,
          assessment:        STEP_SCORE_OBJ,
          positioning:       STEP_SCORE_OBJ,
          hold_process:      STEP_SCORE_OBJ,
          offer:             STEP_SCORE_OBJ,
          close_negotiation: STEP_SCORE_OBJ,
          contract_wrapup:   STEP_SCORE_OBJ,
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
              "intro","reveal","obstacles","future_pace","assessment",
              "positioning","hold_process","offer","close_negotiation","contract_wrapup",
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
                "intro","reveal","obstacles","future_pace","assessment",
                "positioning","hold_process","offer","close_negotiation","contract_wrapup",
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
