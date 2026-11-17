-- Storefront orders are optional in a POS-only local database. Do not fabricate
-- the shared table or change its status constraint when it is present.
begin;

do $$
begin
  if to_regclass('public.orders') is null then
    raise notice 'Skipping realtime setup: public.orders table not found. This is expected in a POS-only local environment.';
    return;
  end if;
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication supabase_realtime is required';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;

  alter table public.orders enable row level security;
  grant select on public.orders to authenticated;

  drop policy if exists "POS staff read incoming web orders" on public.orders;
  create policy "POS staff read incoming web orders"
  on public.orders for select to authenticated
  using (
    status in ('pending', 'pending_payment', 'awaiting_payment')
    and exists (
      select 1 from public.pos_users
      where auth_user_id = (select auth.uid()) and active
        and role in ('cashier', 'manager')
    )
  );

  -- Preserve storefront policies for non-POS identities while preventing legacy
  -- broad authenticated policies from exposing orders to disabled POS staff.
  drop policy if exists "POS order reads require active staff" on public.orders;
  create policy "POS order reads require active staff"
  on public.orders as restrictive for select to authenticated
  using (
    not exists (
      select 1 from public.pos_users where auth_user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.pos_users
      where auth_user_id = (select auth.uid()) and active
        and role in ('cashier', 'manager')
    )
  );

  -- Header alerts need no line items; do not publish order_items or change writes.
end;
$$;

commit;
