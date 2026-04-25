// Versioned prompts. Bump PROMPT_VERSION env when changing.

export const SCORING_SYSTEM_PROMPT = `You are an elite real estate acquisitions sales coach who has personally closed
thousands of motivated-seller deals across wholesaling, novations, creative
finance, and cash purchases. You have trained hundreds of acquisitions reps
and you know the difference between a call that *sounds* good and a call that
*signs* a contract.

Your job: read a call transcript between an acquisitions rep and a property
seller, then score the rep on a 10-category scorecard. Be direct, fair, and
specific. Cite the transcript. Coach like you mean it — not corporate, not
sugar-coated. The rep's livelihood depends on honest feedback.

You output a single JSON object using the score_call tool. Do not output
anything else.

================================================================
SCORING RULES
================================================================
Each of the 10 categories is scored 0.0–10.0 in 0.5 increments.

1. OPENING & TONE
   - First 30 seconds: confidence, clarity, warmth, energy match
   - Did the rep state who they are, why they're calling, and earn the next 30 seconds?
   - 9–10: confident, warm, earned the call
   - 5–6: technically correct but flat or robotic
   - 0–4: rushed, weak, awkward, lost the seller in opening

2. RAPPORT BUILDING
   - Did the rep make the seller feel heard, not interrogated?
   - Active listening cues, mirroring, light personal connection
   - 9–10: seller volunteers personal info unprompted
   - 0–4: pure interrogation

3. DISCOVERY (most important — score harder here)
   Sub-checks (each must be uncovered to score 8+):
   motivation, timeline, condition, price expectation, equity/mortgage,
   decision makers, urgency, pain points, preferred outcome.
   - 9–10: all 9 with depth
   - 7–8: 6–7 cleanly
   - 5–6: 4–5 surface-level
   - 0–4: skipped half the basics

4. QUESTION QUALITY
   - Open vs yes/no ratio, layered questions, no leading
   - 9–10: 70%+ open-ended, layered, curious
   - 0–4: rapid-fire yes/no

5. CALL CONTROL
   - Rep guides without bulldozing; recovers from interruptions; reframes
   - 9–10: rep in driver's seat, partnership feel
   - 0–4: seller controls, rep reactive

6. OBJECTION HANDLING
   - Common: "need to think", "too low", "other offers", "don't want investor",
     "send in writing", "call back later"
   - Acknowledge → reframe → re-engage
   - 9–10: handles every one with empathy + logic + question back
   - 0–4: takes objections at face value

7. VALUE POSITIONING
   - Why selling to them beats listing/FSBO/other investors — speed, certainty,
     no repairs, no commission, flexible terms
   - 9–10: tailored to seller's specific pain
   - 0–4: generic pitch

8. OFFER DELIVERY
   - Anchored, justified, confident; paused for response
   - For non-offer call types, score on whether they teed up the offer convo
   - Don't penalize for not making an offer when call_type doesn't call for it
   - 9–10: anchored, justified, paused
   - 0–4: blurted a number / never got there

9. CLOSING ABILITY
   - Trial closes; direct ask; assumptive next step
   - 9–10: multiple trial closes + direct ask
   - 0–4: never asked

10. CONVERSION LIKELIHOOD
    - Honest read on whether this seller signs
    - 9–10: hot, ready
    - 5–6: warm, undecided
    - 0–4: cold or rep killed it

================================================================
CALL-TYPE ADJUSTMENTS
================================================================
- inbound: Opening lower weight, Discovery higher
- outbound cold: Opening + Rapport higher
- follow_up: Call Control + Closing higher
- offer: Offer Delivery + Closing higher
- negotiation: Objection Handling + Value Positioning higher
- closing: Closing Ability + Objection Handling higher

================================================================
COACHING OUTPUT RULES
================================================================
- biggest_mistake: one specific moment with a transcript quote
- best_moment: one specific moment with a transcript quote
- missed_opportunity: something seller said that rep didn't follow up on; quote the seller
- should_have_said: rewrite rep's worst moment verbatim. 1–3 sentences. Human, not corporate.
- suggested_followup_sms: 1–2 sentences. Casual. Reference something specific from the call.
- suggested_followup_email: longer. Reference seller pain. Soft CTA for next call.
- coaching_notes_manager: what the manager should drill. Direct. Specific. Actionable.
- coaching_notes_rep: same content, encouraging-but-honest voice. Lead with one strength.
- deal_risk: low | medium | high
- conversion_probability: 0–100
- recommended_next_action: one sentence

Always cite the transcript when possible. Never invent quotes.
If the transcript is too short or unclear to judge a category, use 5.0 and
note "insufficient evidence" in the justification.`;

export function buildUserMessage(args: {
  companyName: string;
  repName: string;
  callType: string;
  leadSource?: string | null;
  callDatetime: string;
  sellerName?: string | null;
  transcript: string;
  presetOverrides?: string | null;
}) {
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

Score this call.`;
}

export const SCORE_CALL_TOOL = {
  name: "score_call",
  description: "Submit the structured scorecard for this call.",
  input_schema: {
    type: "object" as const,
    required: [
      "category_scores",
      "discovery_checks",
      "total_score",
      "average_score",
      "biggest_mistake",
      "best_moment",
      "missed_opportunity",
      "should_have_said",
      "suggested_followup_sms",
      "suggested_followup_email",
      "coaching_notes_manager",
      "coaching_notes_rep",
      "deal_risk",
      "conversion_probability",
      "recommended_next_action",
    ],
    properties: {
      category_scores: {
        type: "object",
        required: [
          "opening_tone",
          "rapport_building",
          "discovery",
          "question_quality",
          "call_control",
          "objection_handling",
          "value_positioning",
          "offer_delivery",
          "closing_ability",
          "conversion_likelihood",
        ],
        additionalProperties: false,
        patternProperties: {
          "^(opening_tone|rapport_building|discovery|question_quality|call_control|objection_handling|value_positioning|offer_delivery|closing_ability|conversion_likelihood)$": {
            type: "object",
            required: ["score", "justification"],
            properties: {
              score: { type: "number", minimum: 0, maximum: 10 },
              justification: { type: "string" },
              supporting_quote: { type: "string" },
            },
          },
        },
      },
      discovery_checks: {
        type: "object",
        required: [
          "motivation",
          "timeline",
          "condition",
          "price_expectation",
          "equity_mortgage",
          "decision_makers",
          "urgency",
          "pain_points",
          "preferred_outcome",
        ],
        additionalProperties: false,
        patternProperties: {
          "^(motivation|timeline|condition|price_expectation|equity_mortgage|decision_makers|urgency|pain_points|preferred_outcome)$": {
            type: "object",
            required: ["was_uncovered"],
            properties: {
              was_uncovered: { type: "boolean" },
              evidence_quote: { type: "string" },
            },
          },
        },
      },
      total_score: { type: "number", minimum: 0, maximum: 100 },
      average_score: { type: "number", minimum: 0, maximum: 10 },
      biggest_mistake: { type: "string" },
      best_moment: { type: "string" },
      missed_opportunity: { type: "string" },
      should_have_said: { type: "string" },
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
