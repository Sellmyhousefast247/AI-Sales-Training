-- Per-analysis snapshots.
--
-- Until now, deal_analyses referenced subject_id and the engine pulled
-- comps live from comp_records. Editing or excluding a comp later
-- silently changed what historical analyses "appeared" to be based on.
--
-- These columns capture the comps and subject *as they were* when the
-- analysis was run, so old rows stay accurate after future edits.

alter table public.deal_analyses
  add column if not exists comps_snapshot   jsonb,
  add column if not exists subject_snapshot jsonb;
