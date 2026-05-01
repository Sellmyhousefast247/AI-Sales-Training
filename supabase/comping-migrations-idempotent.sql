-- ────────────────────────────────────────────────────────────────────
--  Comping engine + Road-to-a-Deal migrations (0003–0011), idempotent
-- ────────────────────────────────────────────────────────────────────
--
-- Safe to re-run end-to-end on a database that already has any subset
-- of these objects. Wraps every CREATE in IF NOT EXISTS / drop-first,
-- and gates the destructive 0003 operations on whether the prior state
-- still exists.
--
-- Run once in the Supabase SQL Editor on your production DB.

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0003 · Road to a Deal — re-shape scoring schema                  ║
-- ╚═══════════════════════════════════════════════════════════════════╝

alter table public.category_scores
  drop constraint if exists category_scores_category_check;

drop table if exists public.discovery_checks cascade;

-- Rename `category` → `step` only if the rename hasn't happened yet.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'category_scores'
      and column_name = 'category'
  ) then
    alter table public.category_scores rename column category to step;
  end if;
end $$;

alter table public.category_scores
  drop constraint if exists category_scores_step_check;
alter table public.category_scores
  add  constraint category_scores_step_check
  check (step in (
    'rapport','motivation','asking_price','trial_close_1','first_hold',
    'anchor','negotiation','trial_close_2','second_hold','approval_close'
  ));

alter table public.category_scores drop constraint if exists category_scores_score_check;
alter table public.category_scores
  drop constraint if exists category_scores_step_score_values_check;
alter table public.category_scores
  add  constraint category_scores_step_score_values_check
  check (score in (0, 5, 10));

-- Rename table category_scores → step_scores only if it hasn't been done.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'category_scores'
  )
  and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'step_scores'
  )
  then
    alter table public.category_scores rename to step_scores;
  end if;
end $$;

alter table public.scorecards
  add column if not exists critical_breakpoint_json     jsonb,
  add column if not exists what_was_done_well           text,
  add column if not exists areas_for_improvement_json   jsonb,
  add column if not exists missed_opportunities_json    jsonb,
  add column if not exists improved_call_flow_summary   text,
  add column if not exists final_score                  numeric(4,2);

update public.scorecards set final_score = average_score
where final_score is null;

comment on column public.scorecards.final_score is
  'Road to a Deal final score 0.0–10.0 = total_score / 10';
comment on column public.scorecards.total_score is
  'Road to a Deal total score, sum of step scores (0–100)';

alter table public.company_settings
  add column if not exists script_name      text,
  add column if not exists script_version   text,
  add column if not exists script_content   text;

comment on column public.company_settings.script_content is
  'Master script (e.g. "2026 ACQ Closer Manual V3.8") injected into the AI scoring prompt as <COMPANY_SCRIPT>';

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0004 · Comping engine — subjects / records / signals / analyses  ║
-- ╚═══════════════════════════════════════════════════════════════════╝

create table if not exists public.comp_subjects (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  address         text not null,
  city            text,
  state           text,
  zip             text,
  lat             numeric(9,6),
  lng             numeric(9,6),
  beds            int,
  baths           numeric(3,1),
  sqft            int,
  lot_sqft        int,
  year_built      int,
  property_type   text not null default 'single_family',
  garage_stalls   int,
  source          text,
  source_id       text,
  fetched_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_comp_subjects_company_addr
  on public.comp_subjects(company_id, address);
create index if not exists idx_comp_subjects_geo
  on public.comp_subjects(lat, lng);
drop trigger if exists trg_comp_subjects_updated on public.comp_subjects;
create trigger trg_comp_subjects_updated before update on public.comp_subjects
  for each row execute function public.set_updated_at();

create table if not exists public.comp_records (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  subject_id      uuid not null references public.comp_subjects(id) on delete cascade,
  status          text not null check (status in ('sold','active','pending')),
  price           numeric(12,2) not null,
  close_date      date,
  list_date       date,
  beds            int not null,
  baths           numeric(3,1) not null,
  sqft            int not null,
  lot_sqft        int,
  year_built      int,
  distance_mi     numeric(5,2) not null,
  condition       text not null default 'average'
                    check (condition in ('as_is','average','renovated')),
  garage_stalls   int,
  is_distressed   boolean not null default false,
  property_type   text not null default 'single_family',
  source          text not null,
  source_id       text,
  raw             jsonb,
  fetched_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index if not exists idx_comp_records_subject on public.comp_records(subject_id);
create index if not exists idx_comp_records_company_status
  on public.comp_records(company_id, status);
create unique index if not exists uq_comp_records_source
  on public.comp_records(source, source_id)
  where source_id is not null;

create table if not exists public.comp_market_signals (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references public.companies(id) on delete cascade,
  subject_id               uuid references public.comp_subjects(id) on delete cascade,
  zip                      text,
  schools_rating           numeric(3,1),
  crime_index              numeric(5,2),
  appreciation_12mo        numeric(5,4),
  is_tourism               boolean,
  is_rural                 boolean,
  has_lot_defects          boolean,
  near_train_or_busy_road  boolean,
  curb_appeal              text check (curb_appeal in ('poor','average','good')),
  fetched_at               timestamptz not null default now(),
  created_at               timestamptz not null default now()
);
create index if not exists idx_market_signals_subject on public.comp_market_signals(subject_id);
create index if not exists idx_market_signals_zip on public.comp_market_signals(company_id, zip);

create table if not exists public.deal_analyses (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  subject_id             uuid references public.comp_subjects(id) on delete set null,
  created_by             uuid references public.users(id) on delete set null,
  arv                    numeric(12,2) not null,
  arv_low                numeric(12,2),
  arv_high               numeric(12,2),
  as_is_value            numeric(12,2) not null,
  repair_estimate        numeric(12,2) not null,
  repair_level           text not null,
  buying_pct             numeric(4,3) not null,
  wholesale_mao          numeric(12,2) not null,
  novation_mao           numeric(12,2) not null,
  market_adjusted_mao    numeric(12,2) not null,
  confidence_score       text not null check (confidence_score in ('Low','Medium','High')),
  comps_used             int not null default 0,
  warnings               jsonb not null default '[]'::jsonb,
  payload                jsonb not null,
  created_at             timestamptz not null default now()
);
create index if not exists idx_deal_analyses_company_created
  on public.deal_analyses(company_id, created_at desc);
create index if not exists idx_deal_analyses_subject on public.deal_analyses(subject_id);

alter table public.comp_subjects        enable row level security;
alter table public.comp_records         enable row level security;
alter table public.comp_market_signals  enable row level security;
alter table public.deal_analyses        enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'comp_subjects','comp_records','comp_market_signals','deal_analyses'
  ]
  loop
    execute format('drop policy if exists %1$I_tenant_read on public.%1$I',  t);
    execute format('drop policy if exists %1$I_tenant_write on public.%1$I', t);
    execute format($p$
      create policy %1$I_tenant_read on public.%1$I
        for select using (
          company_id = public.current_company_id()
          or public.current_role_claim() = 'super_admin'
        );
      create policy %1$I_tenant_write on public.%1$I
        for all using (
          (company_id = public.current_company_id()
            and public.current_role_claim() in ('company_admin','manager','rep','super_admin'))
          or public.current_role_claim() = 'super_admin'
        ) with check (
          (company_id = public.current_company_id()
            and public.current_role_claim() in ('company_admin','manager','rep','super_admin'))
          or public.current_role_claim() = 'super_admin'
        );
    $p$, t);
  end loop;
end $$;

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0005 · Comp record overrides                                     ║
-- ╚═══════════════════════════════════════════════════════════════════╝

alter table public.comp_records
  add column if not exists excluded      boolean not null default false,
  add column if not exists notes         text,
  add column if not exists overridden_by uuid references public.users(id) on delete set null,
  add column if not exists overridden_at timestamptz;

create index if not exists idx_comp_records_subject_excluded
  on public.comp_records(subject_id, excluded);

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0006 · Comp photos / list price / DOM / remarks                  ║
-- ╚═══════════════════════════════════════════════════════════════════╝

alter table public.comp_records
  add column if not exists list_price            numeric(12,2),
  add column if not exists original_list_price   numeric(12,2),
  add column if not exists dom_days              int,
  add column if not exists remarks               text,
  add column if not exists photo_urls            jsonb;

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0007 · Per-analysis snapshots                                    ║
-- ╚═══════════════════════════════════════════════════════════════════╝

alter table public.deal_analyses
  add column if not exists comps_snapshot   jsonb,
  add column if not exists subject_snapshot jsonb;

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0008 · Comp warm queue (cron pre-warming)                        ║
-- ╚═══════════════════════════════════════════════════════════════════╝

create table if not exists public.comp_warm_queue (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  zip             text not null,
  state           text,
  city            text,
  last_warmed_at  timestamptz,
  last_error      text,
  priority        int  not null default 0,
  queued_at       timestamptz not null default now(),
  unique(company_id, zip)
);
create index if not exists idx_comp_warm_queue_due
  on public.comp_warm_queue(last_warmed_at nulls first, priority desc);

alter table public.comp_warm_queue enable row level security;

drop policy if exists comp_warm_queue_tenant_read  on public.comp_warm_queue;
drop policy if exists comp_warm_queue_tenant_write on public.comp_warm_queue;
create policy comp_warm_queue_tenant_read on public.comp_warm_queue
  for select using (
    company_id = public.current_company_id()
    or public.current_role_claim() = 'super_admin'
  );
create policy comp_warm_queue_tenant_write on public.comp_warm_queue
  for all using (
    (company_id = public.current_company_id()
      and public.current_role_claim() in ('company_admin','manager','super_admin'))
    or public.current_role_claim() = 'super_admin'
  ) with check (
    (company_id = public.current_company_id()
      and public.current_role_claim() in ('company_admin','manager','super_admin'))
    or public.current_role_claim() = 'super_admin'
  );

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0009 · Condition source tag                                      ║
-- ╚═══════════════════════════════════════════════════════════════════╝

alter table public.comp_records
  add column if not exists condition_source text;

alter table public.comp_records
  drop constraint if exists comp_records_condition_source_check;
alter table public.comp_records
  add  constraint comp_records_condition_source_check
  check (condition_source is null
         or condition_source in ('photos','remarks','manual','provider'));

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0010 · Public share links for analyses                           ║
-- ╚═══════════════════════════════════════════════════════════════════╝

alter table public.deal_analyses
  add column if not exists share_token uuid,
  add column if not exists shared_at   timestamptz;

create unique index if not exists uq_deal_analyses_share_token
  on public.deal_analyses(share_token) where share_token is not null;

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0011 · Comp photos storage bucket                                ║
-- ╚═══════════════════════════════════════════════════════════════════╝

insert into storage.buckets (id, name, public)
values ('comp-photos', 'comp-photos', true)
on conflict (id) do nothing;

-- Done. Re-run any time; every step above is safe to repeat.
