# AI Scoring Prompt — production spec (V3.8 / Road to a Deal)

This prompt is locked to the **2026 ACQ Closer Manual V3.8** "Road to a Deal" framework. The framework overrides any general sales coaching knowledge.

## Model
- **Primary**: `claude-sonnet-4-6` — full scoring
- **Lightweight**: `claude-haiku-4-5-20251001` — pattern detection, follow-up rewrites

## Settings
- `temperature: 0`
- `max_tokens: 4096`
- Output mode: structured JSON via tool-use (`score_call` tool)
- **Prompt caching** on the static system prompt (cache TTL 1h)

## Versioning
Current: **v2.0.0** (Road to a Deal). Every scorecard records `prompt_version` so historic calls can be re-scored when the prompt changes without polluting trend lines.

## Knowledge base injection

The system prompt instructs the model to treat content inside `<COMPANY_SCRIPT>…</COMPANY_SCRIPT>` as the source of truth. We pull `company_settings.script_content` and inject it at the top of every user message. This is where the **2026 ACQ Closer Manual V3.8** lives, per company.

If `script_content` is null, the model falls back to the Road to a Deal framework defined in the system prompt.

## Road to a Deal — the 10 steps

| # | Step | Score key |
|---|---|---|
| 1 | Rapport | `rapport` |
| 2 | Motivation (Why / Condition / Timeline) | `motivation` |
| 3 | Get Asking Price | `asking_price` |
| 4 | Trial Close 1 | `trial_close_1` |
| 5 | First Hold | `first_hold` |
| 6 | Anchor | `anchor` |
| 7 | Negotiation | `negotiation` |
| 8 | Trial Close 2 | `trial_close_2` |
| 9 | Second Hold | `second_hold` |
| 10 | Approval / Close | `approval_close` |

## Scoring discretization

Each step is one of:
- `0` — Not done
- `5` — Attempted but weak
- `10` — Executed correctly

Total score = sum of step scores (0–100). Final score = total / 10 (0.0–10.0). Examples:
- 98 → 9.8
- 84 → 8.4
- 60 → 6.0

The tool schema enforces `enum: [0, 5, 10]` on every step. Schema-fail → one retry → mark `scoring_status='failed'`.

## Mandatory output sections

Every call returns:
1. `step_scores` — all 10 steps with score + justification + supporting quote
2. `total_score` (0–100) and `final_score` (0–10) — recomputed server-side from step sum (we never trust derived fields)
3. `critical_breakpoint` — the FIRST major breakdown:
   - `quote` — exact transcript quote
   - `step_failed` — which step
   - `why_it_caused_loss`
   - `what_should_have_happened`
4. `what_was_done_well` — quotes where possible
5. `areas_for_improvement[]` — each item:
   - `rep_said` (quote)
   - `issue`
   - `better_approach`
   - `corrected_script` (in company tone)
   - optional `step` reference
6. `missed_opportunities[]` — moments the rep didn't follow up on
7. `improved_call_flow_summary` — how the call should have gone
8. Practical fields for downstream use: `suggested_followup_sms`, `suggested_followup_email`, `coaching_notes_manager`, `coaching_notes_rep`, `deal_risk`, `conversion_probability`, `recommended_next_action`

## Quote-based analysis (mandatory)

Every weakness, every breakdown, every "what was done well" callout must cite a direct quote. If you can't find a quote, the moment didn't happen — score it 0. Never invent quotes.

## Validation pipeline

1. Receive Claude tool-use response
2. Parse `input` → validate against Zod schema (`scorecardOutputSchema`)
3. Re-derive `total_score = sum(step_scores)` and `final_score = total/10` server-side; trust those over what the model returned
4. On schema fail: retry once at temperature 0; second fail → mark scoring_status `failed`, surface manual-review CTA
5. Persist to `scorecards` + `step_scores` + `coaching_notes` (kind=`per_call`) in a single transaction

## System prompt (truncated — full text in `src/lib/ai/prompts.ts`)

```
You are an elite real estate acquisitions sales coach, deal-flow analyst,
and performance evaluator. You are NOT a generic sales coach...

CRITICAL KNOWLEDGE BASE PRIORITY
The PRIMARY and MOST IMPORTANT script is "2026 ACQ CLOSER MANUAL V3.8"...

CORE FRAMEWORK: ROAD TO A DEAL (10 steps in order)...

SCORING SYSTEM
100-point system. Each step = 10 points. Allowed scores per step: 0, 5, or 10.

QUOTE-BASED ANALYSIS (MANDATORY)
Every weakness must cite a direct quote.

COACHING METHOD (MANDATORY)
For every major weakness:
  rep_said / issue / better_approach / corrected_script

CRITICAL BREAKPOINT (MANDATORY)
Identify the FIRST major breakdown.

OUTPUT
Single JSON via score_call tool. No prose outside.
```

## Tool definition

See `src/lib/ai/prompts.ts` → `SCORE_CALL_TOOL`. Highlights:
- `step_scores.<key>.score` — `enum: [0, 5, 10]`
- `critical_breakpoint.step_failed` — enum of the 10 step keys
- `areas_for_improvement` — `minItems: 1`
- `deal_risk` — enum `low|medium|high`

## Cost & latency targets

- Input tokens: ~3.5k system (cached) + ~1.5k user (5–10 min call)
- Output tokens: ~2k (more text than the old prompt because of mandatory coaching sections)
- Per-call cost: ~$0.07–0.13 with caching
- Latency: 35–55s p50, 70s p95
- Add transcription cost separately: Deepgram Nova-3 ≈ $0.0043/min audio
