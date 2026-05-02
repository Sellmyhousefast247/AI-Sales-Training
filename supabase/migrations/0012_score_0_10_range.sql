-- Allow any integer 0-10 for step scores (was: only 0, 5, or 10).
--
-- V3 of the knowledge base introduces a finer-grained scoring rubric
-- where the AI may assign any integer 0-10 per step (with anchors at
-- 0, 3, 5, 7, 10). Without this constraint update, the database would
-- reject any score that isn't 0/5/10 — including all the AI's
-- nuanced 6s, 7s, 8s, 9s.

alter table public.step_scores
  drop constraint if exists category_scores_step_score_values_check;

alter table public.step_scores
  drop constraint if exists step_scores_score_range_check;

alter table public.step_scores
  add constraint step_scores_score_range_check
  check (score >= 0 and score <= 10);
