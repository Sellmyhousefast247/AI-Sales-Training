-- Refactor scoring schema to align with the "2026 ACQ Closer Manual V3.8"
-- Road to a Deal framework. Replaces 10-category scoring with 10 named steps
-- and adds structured coaching columns + per-company script content.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Drop the old per-category check constraint and discovery_checks table
-- ─────────────────────────────────────────────────────────────────────
alter table public.category_scores drop constraint if exists category_scores_category_check;

-- discovery_checks is replaced by motivation step scoring + structured
-- improvement items. Drop it.
drop table if exists public.discovery_checks cascade;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Rename category_scores → step_scores conceptually. Keep table
--    name to avoid downstream churn but rename column for clarity and
--    swap the enum.
-- ─────────────────────────────────────────────────────────────────────
alter table public.category_scores rename column category to step;

alter table public.category_scores
  add constraint category_scores_step_check
  check (step in (
    'rapport',
    'motivation',
    'asking_price',
    'trial_close_1',
    'first_hold',
    'anchor',
    'negotiation',
    'trial_close_2',
    'second_hold',
    'approval_close'
  ));

-- Score must be 0, 5, or 10
alter table public.category_scores drop constraint if exists category_scores_score_check;
alter table public.category_scores
  add constraint category_scores_step_score_values_check
  check (score in (0, 5, 10));

alter table public.category_scores rename to step_scores;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Augment scorecards with the V3.8 structured coaching output
-- ─────────────────────────────────────────────────────────────────────
alter table public.scorecards
  add column if not exists critical_breakpoint_json     jsonb,
  add column if not exists what_was_done_well           text,
  add column if not exists areas_for_improvement_json   jsonb,
  add column if not exists missed_opportunities_json    jsonb,
  add column if not exists improved_call_flow_summary   text,
  add column if not exists final_score                  numeric(4,2);

-- final_score is the canonical 0–10 score. Backfill from existing avg.
update public.scorecards set final_score = average_score where final_score is null;

-- Keep average_score for backwards compatibility but final_score is preferred.
comment on column public.scorecards.final_score is 'Road to a Deal final score 0.0–10.0 = total_score / 10';
comment on column public.scorecards.total_score is 'Road to a Deal total score, sum of step scores (0–100)';

-- Some legacy fields are now duplicated by structured arrays.
-- biggest_mistake / best_moment / missed_opportunity / should_have_said
-- can stay (denormalized for fast reads) but the source of truth for
-- coaching detail is areas_for_improvement_json + missed_opportunities_json.

-- ─────────────────────────────────────────────────────────────────────
-- 4. Per-company script content — used to inject the "2026 ACQ Closer
--    Manual V3.8" (or any company's script) into the scoring prompt.
-- ─────────────────────────────────────────────────────────────────────
alter table public.company_settings
  add column if not exists script_name      text,
  add column if not exists script_version   text,
  add column if not exists script_content   text;

comment on column public.company_settings.script_content is
  'Master script (e.g. "2026 ACQ Closer Manual V3.8") injected into the AI scoring prompt as <COMPANY_SCRIPT>';
