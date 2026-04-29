-- Public shareable links for deal analyses.
--
-- A non-null share_token grants read-only access at /share/comp/<token>
-- without authentication. Setting it back to null revokes the link.
-- The unique partial index guarantees token collision is impossible.

alter table public.deal_analyses
  add column if not exists share_token uuid,
  add column if not exists shared_at   timestamptz;

create unique index if not exists uq_deal_analyses_share_token
  on public.deal_analyses(share_token) where share_token is not null;
