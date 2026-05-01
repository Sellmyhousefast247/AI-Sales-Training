-- Acquisitions AI OS — initial schema
-- Multi-tenant SaaS. RLS enforced on all tenant tables.

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ─────────────────────────────────────────────────────────────────────
-- helper: updated_at trigger
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────────────────────────────
-- helper: current company / role from JWT
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.current_company_id()
returns uuid language sql stable as $$
  select nullif(coalesce(auth.jwt() ->> 'company_id',''), '')::uuid;
$$;

create or replace function public.current_role_claim()
returns text language sql stable as $$
  -- Read from `user_role` claim, not `role`. PostgREST treats the `role`
  -- claim specially (it tries to SET ROLE to that value), so we keep our
  -- application role under a non-reserved key.
  select coalesce(auth.jwt() ->> 'user_role', '');
$$;

create or replace function public.current_rep_id()
returns uuid language sql stable as $$
  select nullif(coalesce(auth.jwt() ->> 'rep_id',''),'')::uuid;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- companies
-- ─────────────────────────────────────────────────────────────────────
create table public.companies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text not null unique,
  owner_user_id   uuid,
  logo_url        text,
  primary_color   text default '#0F172A',
  timezone        text not null default 'America/New_York',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create trigger trg_companies_updated before update on public.companies
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- teams
-- ─────────────────────────────────────────────────────────────────────
create table public.teams (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  name             text not null,
  manager_user_id  uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index idx_teams_company on public.teams(company_id);
create trigger trg_teams_updated before update on public.teams
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- users (mirrors auth.users; we own the profile)
-- ─────────────────────────────────────────────────────────────────────
create table public.users (
  id             uuid primary key,                      -- == auth.users.id
  company_id     uuid references public.companies(id) on delete cascade,
  email          citext unique not null,
  full_name      text,
  role           text not null default 'rep'
                  check (role in ('super_admin','company_admin','manager','rep')),
  team_id        uuid references public.teams(id) on delete set null,
  is_active      bool not null default true,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index idx_users_company on public.users(company_id);
create trigger trg_users_updated before update on public.users
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- reps
-- ─────────────────────────────────────────────────────────────────────
create table public.reps (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  user_id            uuid references public.users(id) on delete set null,
  full_name          text not null,
  team_id            uuid references public.teams(id) on delete set null,
  role_title         text,
  hire_date          date,
  current_tier       int default 1 check (current_tier between 1 and 5),
  current_avg_score  numeric(4,2),
  is_active          bool not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index idx_reps_company_active on public.reps(company_id, is_active);
create index idx_reps_user on public.reps(user_id);
create trigger trg_reps_updated before update on public.reps
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- calls
-- ─────────────────────────────────────────────────────────────────────
create table public.calls (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references public.companies(id) on delete cascade,
  rep_id                   uuid not null references public.reps(id) on delete cascade,
  call_datetime            timestamptz not null,
  seller_name              text,
  seller_phone             text,
  property_address         text,
  lead_source              text,
  call_type                text not null
                            check (call_type in ('inbound','outbound','follow_up','offer','negotiation','closing')),
  recording_path           text,
  recording_duration_sec   int,
  transcript_status        text not null default 'pending'
                            check (transcript_status in ('pending','transcribing','ready','failed')),
  scoring_status           text not null default 'pending'
                            check (scoring_status in ('pending','scoring','scored','failed','manual')),
  deal_outcome             text not null default 'unknown'
                            check (deal_outcome in ('contract','appointment','offer_made','follow_up','dead','unknown')),
  next_step                text,
  imported_from            text,
  external_id              text,
  created_by_user_id       uuid references public.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz
);
create index idx_calls_company_dt on public.calls(company_id, call_datetime desc);
create index idx_calls_rep_dt on public.calls(company_id, rep_id, call_datetime desc);
create unique index uq_calls_external on public.calls(company_id, imported_from, external_id)
  where imported_from is not null and external_id is not null;
create trigger trg_calls_updated before update on public.calls
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- transcripts
-- ─────────────────────────────────────────────────────────────────────
create table public.transcripts (
  id              uuid primary key default gen_random_uuid(),
  call_id         uuid not null unique references public.calls(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  content         text not null,
  speakers        jsonb,
  word_count      int,
  rep_word_share  numeric(4,3),
  source          text not null check (source in ('paste','deepgram','whisper','provider')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_transcripts_company on public.transcripts(company_id);
create trigger trg_transcripts_updated before update on public.transcripts
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- scorecards
-- ─────────────────────────────────────────────────────────────────────
create table public.scorecards (
  id                       uuid primary key default gen_random_uuid(),
  call_id                  uuid not null references public.calls(id) on delete cascade,
  company_id               uuid not null references public.companies(id) on delete cascade,
  rep_id                   uuid not null references public.reps(id) on delete cascade,
  model                    text not null,
  prompt_version           text not null,
  total_score              numeric(5,2),
  average_score            numeric(4,2),
  tier_before              int,
  tier_after_projection    int,
  biggest_mistake          text,
  best_moment              text,
  missed_opportunity       text,
  should_have_said         text,
  suggested_followup_sms   text,
  suggested_followup_email text,
  coaching_notes_manager   text,
  coaching_notes_rep       text,
  deal_risk                text check (deal_risk in ('low','medium','high')),
  conversion_probability   int check (conversion_probability between 0 and 100),
  recommended_next_action  text,
  raw_response             jsonb,
  input_tokens             int,
  output_tokens            int,
  cost_usd                 numeric(8,4),
  is_current               bool not null default true,
  scored_by_user_id        uuid references public.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index idx_scorecards_rep_current on public.scorecards(company_id, rep_id, created_at desc)
  where is_current;
create index idx_scorecards_call on public.scorecards(call_id);
create trigger trg_scorecards_updated before update on public.scorecards
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- category_scores
-- ─────────────────────────────────────────────────────────────────────
create table public.category_scores (
  id              uuid primary key default gen_random_uuid(),
  scorecard_id    uuid not null references public.scorecards(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  category        text not null
                    check (category in (
                      'opening_tone','rapport_building','discovery','question_quality',
                      'call_control','objection_handling','value_positioning',
                      'offer_delivery','closing_ability','conversion_likelihood'
                    )),
  score             numeric(4,2) not null check (score between 0 and 10),
  justification     text,
  supporting_quote  text,
  created_at        timestamptz not null default now(),
  unique(scorecard_id, category)
);
create index idx_category_scores_company on public.category_scores(company_id);

-- ─────────────────────────────────────────────────────────────────────
-- discovery_checks
-- ─────────────────────────────────────────────────────────────────────
create table public.discovery_checks (
  id             uuid primary key default gen_random_uuid(),
  scorecard_id   uuid not null references public.scorecards(id) on delete cascade,
  company_id     uuid not null references public.companies(id) on delete cascade,
  check_key      text not null
                  check (check_key in (
                    'motivation','timeline','condition','price_expectation',
                    'equity_mortgage','decision_makers','urgency','pain_points',
                    'preferred_outcome'
                  )),
  was_uncovered  bool not null,
  evidence_quote text,
  created_at     timestamptz not null default now(),
  unique(scorecard_id, check_key)
);
create index idx_discovery_company on public.discovery_checks(company_id);

-- ─────────────────────────────────────────────────────────────────────
-- coaching_notes
-- ─────────────────────────────────────────────────────────────────────
create table public.coaching_notes (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  rep_id           uuid not null references public.reps(id) on delete cascade,
  scorecard_id     uuid references public.scorecards(id) on delete set null,
  author_user_id   uuid references public.users(id) on delete set null,
  kind             text not null check (kind in ('per_call','weekly_plan','manager_note','pattern')),
  body             text not null,
  pattern_key      text,
  is_acknowledged  bool not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_coaching_rep on public.coaching_notes(company_id, rep_id, created_at desc);
create trigger trg_coaching_updated before update on public.coaching_notes
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- tier_history
-- ─────────────────────────────────────────────────────────────────────
create table public.tier_history (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  rep_id              uuid not null references public.reps(id) on delete cascade,
  old_tier            int,
  new_tier            int not null,
  avg_score_at_change numeric(4,2),
  window_used         text not null check (window_used in ('last_10','last_30d','all_time')),
  reason              text,
  created_at          timestamptz not null default now()
);
create index idx_tier_history_rep on public.tier_history(rep_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- incentive_rules
-- ─────────────────────────────────────────────────────────────────────
create table public.incentive_rules (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  name                text not null,
  rules_json          jsonb not null,
  effective_from      date not null,
  effective_to        date,
  created_by_user_id  uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_incentive_rules_company on public.incentive_rules(company_id, effective_from desc);
create trigger trg_incentive_rules_updated before update on public.incentive_rules
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- incentives
-- ─────────────────────────────────────────────────────────────────────
create table public.incentives (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  rep_id                uuid not null references public.reps(id) on delete cascade,
  period_kind           text not null check (period_kind in ('week','month')),
  period_start          date not null,
  period_end            date not null,
  weekly_bonus_amount   numeric(12,2) not null default 0,
  monthly_bonus_amount  numeric(12,2) not null default 0,
  awards_json           jsonb not null default '[]',
  total_amount          numeric(12,2) not null default 0,
  status                text not null default 'projected'
                          check (status in ('projected','approved','paid','withheld')),
  approved_by_user_id   uuid references public.users(id) on delete set null,
  approved_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique(rep_id, period_kind, period_start)
);
create index idx_incentives_company on public.incentives(company_id, period_start desc);
create trigger trg_incentives_updated before update on public.incentives
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- scripts
-- ─────────────────────────────────────────────────────────────────────
create table public.scripts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  call_type    text,
  lead_source  text,
  body         text not null,
  version      int not null default 1,
  is_active    bool not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_scripts_company on public.scripts(company_id);
create trigger trg_scripts_updated before update on public.scripts
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- objections
-- ─────────────────────────────────────────────────────────────────────
create table public.objections (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  key             text not null,
  label           text not null,
  ideal_response  text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(company_id, key)
);
create trigger trg_objections_updated before update on public.objections
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- coaching_patterns
-- ─────────────────────────────────────────────────────────────────────
create table public.coaching_patterns (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid references public.companies(id) on delete cascade,  -- null = global
  key                 text not null,
  label               text not null,
  detector_prompt     text,
  recommended_drill   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index uq_patterns_global on public.coaching_patterns(key) where company_id is null;
create unique index uq_patterns_company on public.coaching_patterns(company_id, key) where company_id is not null;
create trigger trg_patterns_updated before update on public.coaching_patterns
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- company_settings
-- ─────────────────────────────────────────────────────────────────────
create table public.company_settings (
  company_id                 uuid primary key references public.companies(id) on delete cascade,
  rolling_window             text not null default 'last_10'
                              check (rolling_window in ('last_10','last_30d','all_time')),
  min_calls_to_leave_tier1   int not null default 5,
  tier_thresholds_json       jsonb,
  category_weights_json      jsonb,
  scorecard_preset           text not null default 'rei_default',
  monthly_token_budget       int,
  pii_redact_on_export       bool not null default false,
  updated_at                 timestamptz not null default now()
);
create trigger trg_company_settings_updated before update on public.company_settings
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- integrations
-- ─────────────────────────────────────────────────────────────────────
create table public.integrations (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,
  provider                text not null
                            check (provider in (
                              'gohighlevel','wavv','smrtphone','dialpad','aircall',
                              'zapier','n8n','webhook','google_sheets'
                            )),
  credentials_encrypted   bytea,
  config_json             jsonb,
  is_active               bool not null default true,
  last_sync_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index idx_integrations_company on public.integrations(company_id);
create trigger trg_integrations_updated before update on public.integrations
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- reports
-- ─────────────────────────────────────────────────────────────────────
create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  kind            text not null
                    check (kind in (
                      'daily_manager','weekly_rep','weekly_company',
                      'monthly_incentive','quarterly_improvement'
                    )),
  target_user_id  uuid references public.users(id) on delete set null,
  period_start    date,
  period_end      date,
  html_path       text,
  pdf_path        text,
  csv_path        text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index idx_reports_company on public.reports(company_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- subscriptions (V2)
-- ─────────────────────────────────────────────────────────────────────
create table public.subscriptions (
  company_id              uuid primary key references public.companies(id) on delete cascade,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  plan                    text,
  status                  text,
  current_period_end      timestamptz,
  seats                   int,
  call_quota              int,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create trigger trg_subscriptions_updated before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- audit_logs
-- ─────────────────────────────────────────────────────────────────────
create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies(id) on delete set null,
  actor_user_id   uuid references public.users(id) on delete set null,
  action          text not null,
  target_table    text,
  target_id       uuid,
  metadata_json   jsonb,
  ip_address      inet,
  created_at      timestamptz not null default now()
);
create index idx_audit_company on public.audit_logs(company_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────
-- Enable on all tenant tables
alter table public.companies          enable row level security;
alter table public.teams              enable row level security;
alter table public.users              enable row level security;
alter table public.reps               enable row level security;
alter table public.calls              enable row level security;
alter table public.transcripts        enable row level security;
alter table public.scorecards         enable row level security;
alter table public.category_scores    enable row level security;
alter table public.discovery_checks   enable row level security;
alter table public.coaching_notes     enable row level security;
alter table public.tier_history       enable row level security;
alter table public.incentive_rules    enable row level security;
alter table public.incentives         enable row level security;
alter table public.scripts            enable row level security;
alter table public.objections         enable row level security;
alter table public.coaching_patterns  enable row level security;
alter table public.company_settings   enable row level security;
alter table public.integrations       enable row level security;
alter table public.reports            enable row level security;
alter table public.subscriptions      enable row level security;
alter table public.audit_logs         enable row level security;

-- companies: members can read their own; super_admin all
create policy companies_read on public.companies
  for select using (
    id = public.current_company_id()
    or public.current_role_claim() = 'super_admin'
  );
create policy companies_write on public.companies
  for all using (
    (id = public.current_company_id() and public.current_role_claim() in ('company_admin'))
    or public.current_role_claim() = 'super_admin'
  ) with check (
    (id = public.current_company_id() and public.current_role_claim() in ('company_admin'))
    or public.current_role_claim() = 'super_admin'
  );

-- generic tenant policies (company-scoped read/write for admin+manager,
-- read-only company-scoped for rep on most tables; rep-specific tables
-- get a tighter rep policy below).

-- Helper: macro-style — apply policy via DO block to keep file shorter
do $$
declare t text;
begin
  foreach t in array array[
    'teams','users','reps','calls','transcripts','scorecards','category_scores',
    'discovery_checks','coaching_notes','tier_history','incentive_rules','incentives',
    'scripts','objections','coaching_patterns','company_settings','integrations',
    'reports','subscriptions','audit_logs'
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
            and public.current_role_claim() in ('company_admin','manager','super_admin'))
          or public.current_role_claim() = 'super_admin'
        ) with check (
          (company_id = public.current_company_id()
            and public.current_role_claim() in ('company_admin','manager','super_admin'))
          or public.current_role_claim() = 'super_admin'
        );
    $p$, t);
  end loop;
end $$;

-- Rep-specific narrowing: a rep can only SEE their own calls/scorecards/etc.
-- We don't replace the tenant_read above; we instead RESTRICT for reps via
-- additional policies. Since multiple permissive policies are OR'd, we
-- implement rep narrowing by relying on the application layer to filter
-- AND we add a rep-only restrictive policy.

create policy calls_rep_restrict on public.calls
  as restrictive for select using (
    public.current_role_claim() <> 'rep'
    or rep_id = public.current_rep_id()
  );

create policy scorecards_rep_restrict on public.scorecards
  as restrictive for select using (
    public.current_role_claim() <> 'rep'
    or rep_id = public.current_rep_id()
  );

create policy coaching_notes_rep_restrict on public.coaching_notes
  as restrictive for select using (
    public.current_role_claim() <> 'rep'
    or rep_id = public.current_rep_id()
  );

create policy incentives_rep_restrict on public.incentives
  as restrictive for select using (
    public.current_role_claim() <> 'rep'
    or rep_id = public.current_rep_id()
  );

create policy tier_history_rep_restrict on public.tier_history
  as restrictive for select using (
    public.current_role_claim() <> 'rep'
    or rep_id = public.current_rep_id()
  );

-- coaching_patterns global rows readable by everyone in any tenant
create policy coaching_patterns_global_read on public.coaching_patterns
  for select using (company_id is null);
