-- Custom Access Token Hook
-- After applying this migration, enable the hook in the Supabase Dashboard:
--   Authentication → Hooks → Custom Access Token → Enable → select
--   public.custom_access_token_hook
--
-- This injects company_id, role, and rep_id into the JWT so RLS policies
-- can scope on them.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims     jsonb := coalesce(event->'claims', '{}'::jsonb);
  user_id    uuid  := (event->>'user_id')::uuid;
  u          record;
  rep_row    record;
begin
  select company_id, role into u
  from public.users
  where id = user_id;

  if u.company_id is not null then
    claims := jsonb_set(claims, '{company_id}', to_jsonb(u.company_id::text));
  end if;
  if u.role is not null then
    claims := jsonb_set(claims, '{role}', to_jsonb(u.role));
  end if;

  -- attach rep_id if this user is also a rep
  select id into rep_row
  from public.reps
  where user_id = (event->>'user_id')::uuid
  limit 1;
  if rep_row.id is not null then
    claims := jsonb_set(claims, '{rep_id}', to_jsonb(rep_row.id::text));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- Allow supabase_auth_admin to read the rows the hook needs.
grant select on public.users to supabase_auth_admin;
grant select on public.reps  to supabase_auth_admin;

-- Safety-net policies so a user can always read their own profile even
-- before the hook is installed (otherwise RLS blocks the very first lookup).
create policy users_self_read on public.users
  for select using (id = auth.uid());

create policy users_self_update on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());
