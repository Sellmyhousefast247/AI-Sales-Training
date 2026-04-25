# Testing Plan

## Layers

### 1. Unit (Vitest)
- `src/lib/tier.ts` — tier calc across all windows + edge cases (empty, <5 calls, exact thresholds)
- `src/lib/incentive.ts` — rules application
- `src/lib/ai/parse.ts` — Zod validation of scoring response shape
- `src/lib/csv.ts` — round-trip export/import

### 2. Integration (Vitest + Supabase test db)
- Auth flow: sign up → company created → JWT carries company_id
- RLS: rep cannot read another rep's calls; admin can read all in company; cross-company read returns empty
- `/api/calls` → `/api/calls/score` → `scorecards` row with all children populated
- Re-score marks previous `is_current=false`
- Tier recompute cron updates `tier_history` only when threshold crosses

### 3. E2E (Playwright, V2)
- Happy path: signup → onboarding → add rep → paste transcript → see scorecard → see leaderboard
- Permission path: rep login sees only their own calls

### 4. AI quality (calibration suite)
- Maintain `tests/calibration/` — 20 transcripts with manager-graded scores
- Run weekly: score with current prompt, compare to manager scores
- Target: ≥80% category-level agreement (within ±1.0)
- Regression alarm if a prompt change drops agreement >5%

### 5. Load (k6, V2)
- 100 concurrent dashboard requests stay <2s p95
- 20 concurrent score jobs queue cleanly

## Test data
- `tests/fixtures/transcripts/` — 10 real (anonymized) transcripts spanning all call types
- `tests/fixtures/companies/` — 2 fixture companies for isolation tests

## CI
- GitHub Actions:
  - lint + typecheck on every push
  - unit + integration on every push
  - E2E on PR to main (V2)
  - calibration weekly cron

## Pre-prod checklist before each deploy
- [ ] migrations applied to staging, pass smoke
- [ ] AI calibration suite passes
- [ ] Sentry/PostHog new errors triaged
- [ ] Audit log spot-check
