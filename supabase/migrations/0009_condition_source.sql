-- Track HOW a comp's condition was determined.
--
--   photos   → Claude vision classifier (strongest signal)
--   remarks  → Claude text classifier on MLS public remarks
--   manual   → user edited it via PATCH /api/comp/comps/[id]
--   provider → provider returned a non-default condition (rare)
--   NULL     → never classified; treat as the engine's default ("average")
--
-- The detail page renders a small badge so users see at a glance which
-- comps have authoritative photo-based bucketing vs. fallback heuristics.

alter table public.comp_records
  add column if not exists condition_source text
    check (condition_source is null
           or condition_source in ('photos','remarks','manual','provider'));
