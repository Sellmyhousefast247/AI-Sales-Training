-- Supabase Storage bucket for comp / subject photos.
--
-- Public so Claude vision can fetch the URLs server-side and so shared
-- analysis links display photos without auth. Photos are listing imagery
-- by nature; they're not sensitive PII.
--
-- Server-side upload via the service-role client constructs the path as
--   <company_id>/<uuid>.<ext>
-- so each company's uploads land in its own prefix. RLS-style storage
-- policies aren't needed because all writes go through our endpoint.

insert into storage.buckets (id, name, public)
values ('comp-photos', 'comp-photos', true)
on conflict (id) do nothing;
