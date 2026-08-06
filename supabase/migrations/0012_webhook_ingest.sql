-- 0012_webhook_ingest.sql
-- Webhook call ingestion (GoHighLevel, smrtPhone, WAVV, Dialpad, Aircall, generic)
-- + rep alias matching + per-integration webhook tokens.

-- ── integrations: token used in the webhook URL to identify the tenant ──
alter table public.integrations
  add column if not exists webhook_token text;

create unique index if not exists uq_integrations_webhook_token
  on public.integrations(webhook_token)
  where webhook_token is not null;

create unique index if not exists uq_integrations_company_provider
  on public.integrations(company_id, provider);

-- ── rep_aliases: map a provider-side identity (user id, email, phone) to a rep ──
create table if not exists public.rep_aliases (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  provider    text not null
                check (provider in (
                  'gohighlevel','wavv','smrtphone','dialpad','aircall',
                  'zapier','n8n','webhook','google_sheets'
                )),
  alias       text not null,
  rep_id      uuid not null references public.reps(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, provider, alias)
);

create index if not exists idx_rep_aliases_company on public.rep_aliases(company_id);

create trigger trg_rep_aliases_updated before update on public.rep_aliases
  for each row execute function public.set_updated_at();

alter table public.rep_aliases enable row level security;

create policy rep_aliases_tenant_read on public.rep_aliases
  for select using (company_id = public.jwt_company_id());

create policy rep_aliases_tenant_write on public.rep_aliases
  for all using (
    company_id = public.jwt_company_id()
    and public.jwt_role() in ('company_admin','manager','super_admin')
  ) with check (company_id = public.jwt_company_id());

-- ── webhook_events: raw payload log for debugging / replay ──
create table if not exists public.webhook_events (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies(id) on delete cascade,
  integration_id  uuid references public.integrations(id) on delete set null,
  provider        text not null,
  status          text not null default 'received'
                    check (status in ('received','processed','skipped','failed')),
  error           text,
  call_id         uuid references public.calls(id) on delete set null,
  payload_json    jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_webhook_events_company
  on public.webhook_events(company_id, created_at desc);

alter table public.webhook_events enable row level security;

create policy webhook_events_tenant_read on public.webhook_events
  for select using (
    company_id = public.jwt_company_id()
    and public.jwt_role() in ('company_admin','manager','super_admin')
  );
