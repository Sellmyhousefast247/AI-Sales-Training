-- Road to a Deal v2 — step keys for the "Acquisitions Call Script (10/21/26)".
-- Legacy keys stay valid so historical scorecards are untouched.
alter table public.step_scores drop constraint if exists category_scores_step_check;
alter table public.step_scores
  add constraint category_scores_step_check
  check (step in (
    -- v2 (10/21/26 script)
    'intro', 'reveal', 'obstacles', 'future_pace', 'assessment',
    'positioning', 'hold_process', 'offer', 'close_negotiation', 'contract_wrapup',
    -- v1 (legacy, read-only history)
    'rapport', 'motivation', 'asking_price', 'trial_close_1', 'first_hold',
    'anchor', 'negotiation', 'trial_close_2', 'second_hold', 'approval_close'
  ));
