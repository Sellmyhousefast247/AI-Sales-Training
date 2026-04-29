-- Comping & Deal Analysis Engine
-- Persists subject lookups, comp records pulled from data providers, and
-- final deal analyses. Multi-tenant via company_id with the same RLS
-- conventions as 0001.

-- ─────────────────────────────────────────────────────────────────────
-- comp_subjects: one row per address we've looked up
-- ─────────────────────────────────────────────────────────────────────
create table public.comp_subjects (
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
create index idx_comp_subjects_company_addr
  on public.comp_subjects(company_id, address);
create index idx_comp_subjects_geo
  on public.comp_subjects(lat, lng);
create trigger trg_comp_subjects_updated before update on public.comp_subjects
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- comp_records: every comp we've pulled, keyed to a subject
-- ─────────────────────────────────────────────────────────────────────
create table public.comp_records (
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
create index idx_comp_records_subject on public.comp_records(subject_id);
create index idx_comp_records_company_status
  on public.comp_records(company_id, status);
create unique index uq_comp_records_source
  on public.comp_records(source, source_id)
  where source_id is not null;

-- ─────────────────────────────────────────────────────────────────────
-- comp_market_signals: schools, crime, etc. (cached per zip or subject)
-- ─────────────────────────────────────────────────────────────────────
create table public.comp_market_signals (
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
create index idx_market_signals_subject on public.comp_market_signals(subject_id);
create index idx_market_signals_zip on public.comp_market_signals(company_id, zip);

-- ─────────────────────────────────────────────────────────────────────
-- deal_analyses: every analyzeDeal() result we want to persist
-- ─────────────────────────────────────────────────────────────────────
create table public.deal_analyses (
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
create index idx_deal_analyses_company_created
  on public.deal_analyses(company_id, created_at desc);
create index idx_deal_analyses_subject on public.deal_analyses(subject_id);

-- ─────────────────────────────────────────────────────────────────────
-- RLS — same tenant scoping as 0001
-- ─────────────────────────────────────────────────────────────────────
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
