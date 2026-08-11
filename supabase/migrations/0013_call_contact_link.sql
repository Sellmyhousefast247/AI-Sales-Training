-- Store the provider-side contact id (GHL/XLeads contactId) on each imported
-- call so the seller name can deep-link to their CRM contact profile.
alter table public.calls
  add column if not exists external_contact_id text;

comment on column public.calls.external_contact_id is
  'Provider contact id (e.g. GHL contactId) for deep-linking the seller to their CRM profile.';
