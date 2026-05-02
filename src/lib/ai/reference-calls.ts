/**
 * Calibration anchors injected into the scoring prompt.
 *
 * These are condensed summaries of three real calls labeled with rubric
 * grades. Their job is to give the AI scorer concrete points of comparison
 * when grading a new transcript — "this transcript looks more like Call #02
 * than #03, so motivation is closer to a 7 than a 3."
 *
 * Full transcripts and analyses live in docs/training/reference-calls/.
 * These summaries are intentionally tighter than the full files to keep
 * the prompt compact (target: ~2k tokens for all three).
 *
 * Note about historical V2 grades: the reference calls were originally
 * scored under V2's coarser rubric. V3's rubric is meaningfully stricter
 * (WAM-aligned Motivation, cap rules, new red flags). The system prompt
 * tells the AI to learn the SHAPE of these calls, not anchor exactly to
 * their numerical scores.
 */

export const REFERENCE_CALL_SUMMARIES = `# REFERENCE CALL ANCHORS

The following are three real calls condensed for calibration. Use them
to triangulate where a new transcript sits on the rubric — but apply
the V3 rubric strictly. Historical V2 scores listed here would adjust
downward 5-15 points under V3's stricter Motivation / cap-rule rules.

---

## Reference Call #01 — STRONG RAPPORT, WEAK STRUCTURE
Historical V2 score: 40/100. Outcome: contract signed a week later at $180k for two parcels.

The senior rep ran a warm, conversational call but skipped most of the
script's structural beats. Specifically:

- Opener was informal ("It's Curtis, sorry we're playing phone tag") —
  no company name for nearly 4 minutes.
- Got the seller's WHY (recently inherited, lives out of state, just
  got promoted, "want this off my chest") through listening, not
  through the WAM 5-stage framework. Surface motivation but no
  emotional impact probe; no future pacing.
- Asked the asking-price question but skipped the "how companies like
  ours work" educational pivot entirely.
- NO Trial Close 1, NO First Hold, NO Second Hold.
- Anchor was soft and in the rep's own voice ("I think we'll need to
  be in the probably low 2 hundreds maybe once it's fixed up") —
  hedging language, no back-office framing, no pause.
- Trial Close 2 was informal but got a yes.
- Approval framing was missing; the seller carried the close herself
  ("I want this headache off my chest, send me that contract right
  now, I'll sign it"). Rep agreed and sent the contract.

What the AI scorer should learn from this call:
- High-motivation sellers will close even with a weak script.
- Strong rapport partially offsets structural gaps but not entirely.
- Estimated value left on the table: $30-45k (a tighter anchor would
  likely have closed at $135-150k instead of $180k).
- Under V3 rubric: Motivation ~6 (WAM stages skipped), Trial Close 1
  = 0, Holds = 0, Anchor = 4, Approval ~7. This is a 30-40/100 call
  by V3.

---

## Reference Call #02 — MOSTLY ON SCRIPT, OFF-SCRIPT PROMISES
Historical V2 score: 68/100. Outcome: contract signed same afternoon
at $58,500 via novation.

A new rep handled an inbound call from an older couple urgently
needing to relocate (wife's health issues post-triple-bypass, can't
handle NY winters). What this rep did well structurally:

- Asked "good time?" gate.
- Got the WHY directly (wife's health, must move before winter).
- Ran the educational pivot ("opposite of a real estate agent...").
- Trial Close 1 with proper conditional framing AND verbal yes —
  textbook execution.
- Real First Hold; came back with proper "they had a couple more
  questions" rapport rebuild.
- Strong Anchor: "I was peeking over [Underwriter Name]'s shoulder,
  somewhere between $33,500 and $36,800" — back-office framing, range,
  named underwriter.
- Pivoted to novation cleanly when cash didn't work.
- Got "approved at $58,500" framing out.

What this rep did poorly:
- Off-script promises ("we'll help you buy a house in NC", "if you
  need 5 months we'll give you 5 months") — services not pre-approved.
- Mid-anchor, gave a SECOND number ($40k cash max) which undercut the
  back-office framing and read as the rep negotiating against himself.
- Trial Close 2 was implicit, not asked explicitly.
- Wife expressed anxiety ("I'm terrified if we sign and don't get a
  house") — rep deflected with "we're family now" instead of walking
  through actual contract mechanics (closing date flexibility,
  amendment options).
- Closed with "I love you" — broke professional frame.

What the AI scorer should learn:
- Hitting the structural beats (Trial Close 1, anchor framing,
  novation pivot) is what got this deal where Call #01 left money on
  the table.
- Off-script promises are scoreable defects (-2 to -3), even when the
  seller likes them — the company may not be able to deliver.
- Wife/spouse anxiety calls for mechanics, not assurance.
- Under V3 rubric: still around 60-65/100 (Motivation drops slightly
  for skipped emotional probe + future pacing, but most other steps
  remain solid).

---

## Reference Call #03 — SAME REP AS #02, OFF-SCRIPT, DEAL PENDING
Historical V2 score: 33/100. Outcome: no contract in-call; rep texted
two options ($45k cash / $60k novation) and punted to Monday callback.
Final outcome unknown.

Same rep as #02, recall after a disconnect. What went wrong:

- After the disconnect, the rep went straight back to questions ("And
  time frame, what did you say?") with NO rapport reset. This was a
  major missed opportunity.
- Asked condition questions in a list ("tell me about the plumbing,
  electrical, roof, foundation") instead of letting the seller frame
  the situation in his own words. Discovery skipped.
- Did the "how companies work" educational pivot, slightly rushed.
- Trial Close 1 with conditional framing, got verbal yes.
- ~8-minute First Hold (way too long).
- Anchor: "$33,500 to $36,800" but immediately followed with "we're
  looking at $35, $40, $45 at the most cash" — three competing
  numbers, dilutes authority.
- NEVER asked the seller's counter ("what's the best you could do?").
  Instead pulled up Zillow comparables LIVE during the call ($110k,
  $114k) — completely off-script and undercuts the back-office
  framing.
- NO Trial Close 2 — slid into "do you want me to text you the two
  options?".
- NO Second Hold.
- Tried to send the contract via email; seller couldn't access email;
  rep punted to texting two options instead of solving in real-time.
- Punted to Monday callback (4 days out).
- Called the seller by his last name then corrected — signal that the
  rep wasn't tracking who he was talking to.

What the AI scorer should learn:
- Reconnects after disconnects need an explicit rapport reset.
- Multiple competing anchor numbers triggers the "anchor capped at 5"
  rule.
- Showing comparable sales live during the call triggers the
  "negotiation capped at 5" rule.
- Skipping the seller's counter is a Negotiation step failure.
- Punting to a multi-day callback after a Trial Close 2 yes is a
  -2 to Approval.
- Under V3 rubric: this would score below 30 because of all the cap
  rules and red flags triggered.

---

## Calibration shape (V3 rubric)

For a new transcript:
- Looks like #03 (off-script, multiple anchor numbers, Zillow live,
  seller's counter never pulled, multi-day punt) → low 20s.
- Looks like #01 (warm rapport but skipped Trial Close 1 and the
  educational pivot, soft anchor in rep's voice) → low-to-mid 30s.
- Looks like #02 (educational pivot done, TC1 with conditional
  framing, back-office anchor, novation pivot) → low-to-mid 60s.
- Tighter than #02 (no off-script promises, full WAM Discovery, clean
  Approval close) → 80+.
- Pristine end-to-end execution → 90+.
`;
