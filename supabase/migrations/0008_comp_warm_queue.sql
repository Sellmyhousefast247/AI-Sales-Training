-- Background cache pre-warm queue.
--
-- Each row says "this company wants the comping engine kept warm for
-- this zip code." The cron job picks up the oldest entries, fetches
-- market signals (schools / crime / etc.) into comp_market_signals so
-- live calculator runs return instantly.

create table public.comp_warm_queue (
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
create index idx_comp_warm_queue_due
  on public.comp_warm_queue(last_warmed_at nulls first, priority desc);

alter table public.comp_warm_queue enable row level security;

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
