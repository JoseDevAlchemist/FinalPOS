begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

insert into auth.users(id, email) values
  ('f0000000-0000-4000-8000-000000000001', 'sale-test-cashier@pedigree.local'),
  ('f0000000-0000-4000-8000-000000000002', 'sale-test-manager@pedigree.local');
update public.pos_users set auth_user_id = 'f0000000-0000-4000-8000-000000000001'
 where id = 'a1c9f1e2-0000-4000-8000-000000000001';
update public.pos_users set auth_user_id = 'f0000000-0000-4000-8000-000000000002'
 where id = 'a1c9f1e2-0000-4000-8000-000000000002';

-- Snapshot existing local data so the suite can run after browser tests too.
update public.products set base_price = 12500, discount_percent = 0, active = true
 where id = 'c0a80101-0000-4000-8000-000000000001';
update public.product_colors set stock_quantity = 4
 where id = 'c0a80201-0000-4000-8000-000000000001';
create temporary table test_baseline as select
  (select count(*)::integer from public.pos_sales) sales,
  (select count(*)::integer from public.pos_sale_items) lines,
  (select count(*)::integer from public.pos_sale_audit) audits,
  (select count(*)::integer from public.stock_movements) movements,
  (select stock_quantity from public.products where name = 'Karura Tote') product_stock;
grant select on test_baseline to authenticated;

create function pg_temp.sale(
  sale_uuid uuid default gen_random_uuid(), total integer default 12500,
  price integer default 12500, qty integer default 1,
  cashier uuid default 'a1c9f1e2-0000-4000-8000-000000000001',
  tendered integer default 13000,
  color uuid default 'c0a80201-0000-4000-8000-000000000001',
  product uuid default 'c0a80101-0000-4000-8000-000000000001'
) returns boolean language sql as $$
  select public.pos_record_sale(sale_uuid, cashier, total, 'cash', tendered,
    jsonb_build_array(jsonb_build_object('product_id', product, 'color_id', color,
      'quantity', qty, 'price_at_sale', price)));
$$;

select ok(has_function_privilege('authenticated', 'public.pos_record_sale(uuid,uuid,integer,text,integer,jsonb)', 'execute'), 'authenticated can call');
select ok(not has_function_privilege('anon', 'public.pos_record_sale(uuid,uuid,integer,text,integer,jsonb)', 'execute'), 'anon cannot call');
select ok(not has_function_privilege('authenticated', 'public.pos_create_sale(uuid,jsonb,text,integer,integer)', 'execute'), 'old money entry point revoked');
select is((select stock_quantity from products where name = 'Karura Tote'),
  (select sum(stock_quantity)::integer from product_colors where product_id = 'c0a80101-0000-4000-8000-000000000001'), 'product projection initialized');

select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok($$select pg_temp.sale(cashier := 'a1c9f1e2-0000-4000-8000-000000000002')$$, '42501', 'not_authorized', 'cashier spoof rejected');
select throws_ok($$select pg_temp.sale(price := 1, total := 1)$$, '22023', 'price_mismatch', 'forged price rejected');
select throws_ok($$select pg_temp.sale(total := 1)$$, '22023', 'total_mismatch', 'forged total rejected');
select throws_ok($$select pg_temp.sale(tendered := 1)$$, '22023', 'insufficient_cash', 'short cash rejected');
select throws_ok($$select pg_temp.sale(qty := 0)$$, '22023', 'invalid_quantity', 'zero quantity rejected');
select throws_ok($$select pg_temp.sale(qty := 1000, total := 12500000, tendered := 12500000)$$, '23514', 'insufficient_stock:Karura Tote', 'overselling rejected');
select throws_ok($$select pg_temp.sale(color := 'c0a80201-0000-4000-8000-000000000003')$$, 'P0002', 'color_not_found', 'foreign color rejected');
select throws_ok($$select public.pos_record_sale(gen_random_uuid(), 'a1c9f1e2-0000-4000-8000-000000000001', 0, 'cash', 0, '[]')$$, '22023', 'cart_empty_or_too_large', 'empty cart rejected');
select throws_ok($$select public.pos_record_sale(gen_random_uuid(), 'a1c9f1e2-0000-4000-8000-000000000001', 12500, 'mpesa', 13000, '[]')$$, '42501', 'not_authorized', 'unverified M-Pesa cannot bypass cash checkout');
select is((select count(*)::integer from pos_sales), (select sales from test_baseline), 'failed requests leave no headers');
select is((select count(*)::integer from pos_sale_items), (select lines from test_baseline), 'failed requests leave no lines');
select is((select stock_quantity from products where name = 'Karura Tote'), (select product_stock from test_baseline), 'rejected requests roll back product stock');
select throws_ok($$select public.pos_record_sale(gen_random_uuid(), 'a1c9f1e2-0000-4000-8000-000000000001', 62500, 'cash', 62500,
  '[{"product_id":"c0a80101-0000-4000-8000-000000000001","color_id":"c0a80201-0000-4000-8000-000000000001","quantity":3,"price_at_sale":12500},
    {"product_id":"c0a80101-0000-4000-8000-000000000001","color_id":"c0a80201-0000-4000-8000-000000000001","quantity":2,"price_at_sale":12500}]')$$,
  '23514', 'insufficient_stock:Karura Tote', 'duplicate lines cannot oversell');
select is((select stock_quantity from products where name = 'Karura Tote'), (select product_stock from test_baseline), 'later line failure rolls back earlier decrement');
select is(pg_temp.sale(sale_uuid := 'f1000000-0000-4000-8000-000000000001'), true, 'cash sale recorded');
select is(pg_temp.sale(sale_uuid := 'f1000000-0000-4000-8000-000000000001'), false, 'replay returns false');
select is((select count(*)::integer from pos_sales), (select sales + 1 from test_baseline), 'replay creates one header');
select is((select count(*)::integer from pos_sale_items), (select lines + 1 from test_baseline), 'replay creates one line');
select is((select change_due from pos_sales where client_uuid = 'f1000000-0000-4000-8000-000000000001'), 500, 'canonical change stored');
select is((select payment_status from pos_sales where client_uuid = 'f1000000-0000-4000-8000-000000000001'), 'paid', 'cash confirmed');
select is((select count(*)::integer from pos_sale_audit), 0, 'cashier cannot read audit');
select throws_ok($$update public.products set stock_quantity = 100$$, '42501', null, 'cashier cannot overwrite stock');
reset role;
select is((select count(*)::integer from stock_movements where reason = 'sale:f1000000-0000-4000-8000-000000000001'), 1, 'one ledger movement');
select is((select count(*)::integer from pos_sale_audit), (select audits + 1 from test_baseline), 'one audit event');
select is((select stock_quantity from products where name = 'Karura Tote'),
  (select sum(stock_quantity)::integer from product_colors where product_id = 'c0a80101-0000-4000-8000-000000000001'), 'product and colour stock agree');
select is((select stock_quantity from products where name = 'Karura Tote'), (select product_stock - 1 from test_baseline), 'product stock decremented exactly once');
select is((select stock_quantity from product_colors where id = 'c0a80201-0000-4000-8000-000000000001'), 3, 'colour stock decremented exactly once');
select is((select count(*)::integer from stock_movements), (select movements + 1 from test_baseline), 'rejected requests leave no ledger entries');
update public.pos_users set active = false where id = 'a1c9f1e2-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.sale()$$, '42501', 'not_authorized', 'disabled staff denied');
reset role;
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is((select count(*)::integer from pos_sale_audit), (select audits + 1 from test_baseline), 'manager can read audit');
select is(public.pos_manager_adjust_color_stock(
  'c0a80101-0000-4000-8000-000000000001',
  'c0a80201-0000-4000-8000-000000000001', 2, 'test_restock'), 5, 'existing restock path remains consistent');
select is((select stock_quantity from products where name = 'Karura Tote'), (select product_stock + 1 from test_baseline), 'restock updates aggregate projection');
select throws_ok($$select pg_temp.sale(sale_uuid := 'f1000000-0000-4000-8000-000000000001', cashier := 'a1c9f1e2-0000-4000-8000-000000000002')$$, '42501', 'not_authorized', 'another staff member cannot replay someone else''s UUID');
reset role;
update public.products set base_price = 1005, discount_percent = 90
 where id = 'c0a80101-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(pg_temp.sale(total := 101, price := 101, tendered := 101, cashier := 'a1c9f1e2-0000-4000-8000-000000000002'), true, 'catalogue discount rounds half KES up');
reset role;
set local role anon;
select throws_ok($$select pg_temp.sale()$$, '42501', null, 'anon execution denied');
select throws_ok($$select * from public.pos_sale_audit$$, '42501', null, 'anon audit read denied');
reset role;
select * from finish();
rollback;
