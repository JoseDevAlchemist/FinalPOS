-- Stop the legacy anon roster exposure and key staff reads to auth.uid().
-- The login route and session loader use the service-role client; browser
-- clients may only read the safe staff columns for themselves (or all staff if
-- they are an active manager). pin_hash is never granted.

alter table public.pos_users enable row level security;

drop policy if exists "pos_users are readable by the till" on public.pos_users;

create or replace function public.pos_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.pos_users
    where auth_user_id = auth.uid()
      and role = 'manager'
      and active
  );
$$;

revoke all on function public.pos_is_manager() from public;
grant execute on function public.pos_is_manager() to authenticated;

drop policy if exists "Staff can read their own POS row" on public.pos_users;
create policy "Staff can read their own POS row"
  on public.pos_users
  for select
  to authenticated
  using (auth.uid() = auth_user_id);

drop policy if exists "Managers can read the POS roster" on public.pos_users;
create policy "Managers can read the POS roster"
  on public.pos_users
  for select
  to authenticated
  using (public.pos_is_manager());

revoke all on table public.pos_users from anon;
revoke select on table public.pos_users from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.pos_users
  from authenticated;

grant select (id, name, role, active, auth_user_id, created_at)
  on table public.pos_users
  to authenticated;
