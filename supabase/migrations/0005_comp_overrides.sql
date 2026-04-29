-- Comp record overrides — let users mark comps as excluded from analysis,
-- edit fields the providers got wrong, and track who changed what.

alter table public.comp_records
  add column if not exists excluded     boolean not null default false,
  add column if not exists notes        text,
  add column if not exists overridden_by uuid references public.users(id) on delete set null,
  add column if not exists overridden_at timestamptz;

create index if not exists idx_comp_records_subject_excluded
  on public.comp_records(subject_id, excluded);
