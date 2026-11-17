begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);
select ok(exists (
  select 1 from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
), 'orders is published for realtime');
select ok((select relrowsecurity from pg_class where oid = 'public.orders'::regclass), 'orders has RLS');
select ok(has_table_privilege('authenticated', 'public.orders', 'select'), 'staff role has SELECT grant');
select ok(exists (
  select 1 from pg_policies where schemaname = 'public' and tablename = 'orders'
    and policyname = 'POS order reads require active staff' and permissive = 'RESTRICTIVE'
), 'disabled staff gate cannot be bypassed by permissive storefront read policies');
insert into auth.users(id, email) values
  ('f6000000-0000-4000-8000-000000000001', 'realtime-cashier@pedigree.local');
update public.pos_users set auth_user_id = 'f6000000-0000-4000-8000-000000000001'
where id = 'a1c9f1e2-0000-4000-8000-000000000001';
-- Fixture matches the current storefront checkout contract (003 + 006).
insert into public.orders (
  id, order_number, customer_name, customer_phone, delivery_method,
  subtotal, total, status
) values (
  'f6000000-0000-4000-8000-000000000010', 'POS-REALTIME-TEST',
  'Realtime fixture', '0700000000', 'pickup', 1500, 1500, 'pending_payment'
);
select set_config('request.jwt.claim.sub', 'f6000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok('select id, order_number, customer_name, total, status from public.orders', 'cashier may query notification fields');
select is((select total from public.orders where id = 'f6000000-0000-4000-8000-000000000010'), 1500, 'active cashier receives incoming order');
reset role;
update public.pos_users set active = false where auth_user_id = 'f6000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.orders), 0::bigint, 'disabled cashier cannot read any orders');
reset role;
select set_config('request.jwt.claim.sub', 'f6000000-0000-4000-8000-000000000099', true);
set local role authenticated;
select is((select count(*) from public.pos_users), 0::bigint, 'nonstaff has no staff identity for notification policy');
reset role;
select ok(not exists (
  select 1 from pg_policies where schemaname = 'public' and tablename = 'orders'
  and policyname = 'POS staff read incoming web orders' and 'anon' = any(roles)
), 'notification policy does not grant anonymous order access');
select * from finish();
rollback;
