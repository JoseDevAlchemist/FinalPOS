begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values
 ('fb000000-0000-4000-8000-000000000001','digital-cashier@pedigree.local'),
 ('fb000000-0000-4000-8000-000000000002','digital-manager@pedigree.local');
update public.pos_users set auth_user_id='fb000000-0000-4000-8000-000000000001',pin_hash=extensions.crypt('1234',extensions.gen_salt('bf')) where id='a1c9f1e2-0000-4000-8000-000000000001';
update public.pos_users set auth_user_id='fb000000-0000-4000-8000-000000000002',pin_hash=extensions.crypt('4826',extensions.gen_salt('bf')) where id='a1c9f1e2-0000-4000-8000-000000000002';
insert into public.products(id,name,slug,description,category,base_price,discount_percent,active,is_website_published)
 values('fb100000-0000-4000-8000-000000000001','Digital bag fixture','digital-bag-fixture','','bag',4000,10,true,false);
insert into public.product_colors(id,product_id,color_name,color_hex,stock_quantity)
 values('fb200000-0000-4000-8000-000000000001','fb100000-0000-4000-8000-000000000001','Tan','#8B4513',2);
insert into public.pos_sales(id,client_uuid,staff_id,staff_name,subtotal,total,payment_method,payment_status) values
 ('fb300000-0000-4000-8000-000000000001','fb300000-0000-4000-8000-000000000001','a1c9f1e2-0000-4000-8000-000000000001','Original cashier',1000,1000,'cash','paid'),
 ('fb300000-0000-4000-8000-000000000002','fb300000-0000-4000-8000-000000000002','a1c9f1e2-0000-4000-8000-000000000001','Original cashier',1000,1000,'mpesa','pending');
insert into public.pos_sale_items(id,sale_id,product_id,color_id,name,color_name,unit_price,quantity,line_total)
 values('fb400000-0000-4000-8000-000000000001','fb300000-0000-4000-8000-000000000001','fb100000-0000-4000-8000-000000000001','fb200000-0000-4000-8000-000000000001','Original bag','Tan',1000,1,1000);
create function pg_temp.quote(p_name text default 'Customer A') returns uuid language sql as $$
 select public.pos_create_quotation('fb500000-0000-4000-8000-000000000001',p_name,'254712345678',
 '[{"product_id":"fb100000-0000-4000-8000-000000000001","color_id":"fb200000-0000-4000-8000-000000000001","quantity":2,"unit_price":1,"total":1}]');
$$;
create function pg_temp.approve(p_pin text default '4826') returns jsonb language sql as $$
 select public.pos_process_return_with_pin('a1c9f1e2-0000-4000-8000-000000000001',p_pin,
 'fb600000-0000-4000-8000-000000000001','fb300000-0000-4000-8000-000000000001','Wrong size',
 '[{"sale_item_id":"fb400000-0000-4000-8000-000000000001","quantity":1}]');
$$;
select ok(not has_function_privilege('authenticated','public.pos_process_return_with_pin(uuid,text,uuid,uuid,text,jsonb)','execute'),'cashier cannot invoke service approval bridge');
select ok(not has_function_privilege('anon','public.pos_create_quotation(uuid,text,text,jsonb)','execute'),'anonymous cannot create quotes');
select ok(not has_table_privilege('authenticated','public.pos_quotations','insert'),'direct quote writes denied');
select ok(not has_table_privilege('authenticated','public.pos_receipt_documents','update'),'receipt snapshots immutable');
set local role anon;
select throws_ok($$select * from public.pos_quotations$$,'42501',null,'anonymous cannot enumerate quote tokens');
select throws_ok($$select * from public.pos_receipt_documents$$,'42501',null,'anonymous cannot enumerate receipt tokens');
reset role;
select set_config('request.jwt.claim.sub','fb000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select lives_ok($$select pg_temp.quote()$$,'cashier creates quote');
select is((select total from public.pos_quotations where client_uuid='fb500000-0000-4000-8000-000000000001'),7200,'quote uses server prices and discounts, ignores forged prices');
select is((select stock_quantity from public.products where id='fb100000-0000-4000-8000-000000000001'),2,'quote does not reserve or change stock');
select is((select count(*)::integer from public.stock_movements where product_id='fb100000-0000-4000-8000-000000000001'),0,'quote writes no inventory ledger movement');
select is(pg_temp.quote(),(select id from public.pos_quotations where client_uuid='fb500000-0000-4000-8000-000000000001'),'quote retry returns same snapshot');
select throws_ok($$select pg_temp.quote('Changed customer')$$,'22023','idempotency_mismatch','quote retry cannot change customer');
select lives_ok($$select public.pos_create_receipt_document('fb500000-0000-4000-8000-000000000002','fb300000-0000-4000-8000-000000000001','Customer A','254712345678')$$,'cashier creates paid receipt document');
select is((select total from public.pos_receipt_documents where client_uuid='fb500000-0000-4000-8000-000000000002'),1000,'receipt preserves original paid total');
select is((select staff_name from public.pos_receipt_documents where client_uuid='fb500000-0000-4000-8000-000000000002'),'Original cashier','receipt names original serving cashier');
select is((select items->0->>'unit_price' from public.pos_receipt_documents where client_uuid='fb500000-0000-4000-8000-000000000002'),'1000','receipt ignores current catalogue price');
select throws_ok($$select public.pos_create_receipt_document(gen_random_uuid(),'fb300000-0000-4000-8000-000000000002','Customer A','254712345678')$$,'P0002','paid_sale_not_found','unverified payment cannot produce a paid receipt');
select is((public.pos_staff_return_sale_details('fb300000-0000-4000-8000-000000000001')->>'total')::integer,1000,'cashier may load approval form');
select throws_ok($$select pg_temp.approve()$$,'42501',null,'cashier cannot bypass server PIN verification');
reset role;
update public.products set base_price=9000 where id='fb100000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','fb000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select lives_ok($$select pg_temp.quote()$$,'quote retry after catalogue repricing succeeds');
select is((select total from public.pos_quotations where client_uuid='fb500000-0000-4000-8000-000000000001'),7200,'quote remains its original snapshot after price change');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role","sub":"fb000000-0000-4000-8000-000000000001"}',true);
set local role service_role;
select is(pg_temp.approve('1234')->>'error','invalid_pin','cashier PIN is not manager approval');
select pg_temp.approve('0000');
select pg_temp.approve('0000');
select pg_temp.approve('0000');
select is(pg_temp.approve('0000')->>'error','pin_locked','fifth failed approval locks PIN attempts');
select is(pg_temp.approve()->>'error','pin_locked','valid PIN cannot bypass active lockout');
reset role;
update public.pos_return_pin_attempts set locked_until=now()-interval '1 second' where cashier_id='a1c9f1e2-0000-4000-8000-000000000001';
update public.pos_users set pin_hash=extensions.crypt('4826',extensions.gen_salt('bf')) where id='a1c9f1e2-0000-4000-8000-000000000001';
set local role service_role;
select is(pg_temp.approve()->>'error','invalid_pin','ambiguous legacy cashier/manager PIN cannot authorize');
reset role;
update public.pos_users set pin_hash=extensions.crypt('1234',extensions.gen_salt('bf')) where id='a1c9f1e2-0000-4000-8000-000000000001';
set local role service_role;
select ok(pg_temp.approve() ? 'return_id','valid manager PIN authorizes atomic return');
select is(auth.uid(),'fb000000-0000-4000-8000-000000000001'::uuid,'cashier database identity restored after approval');
select is((current_setting('request.jwt.claims',true)::jsonb->>'sub'),'fb000000-0000-4000-8000-000000000001','full JWT context restored');
select ok(pg_temp.approve() ? 'return_id','approval retry recovers the same return');
reset role;
select is((select refund_amount from public.pos_returns where client_uuid='fb600000-0000-4000-8000-000000000001'),1000,'PIN approval uses historical refund value');
select is((select requested_by from public.pos_returns where client_uuid='fb600000-0000-4000-8000-000000000001'),'a1c9f1e2-0000-4000-8000-000000000001'::uuid,'requesting cashier audited');
select is((select processed_by from public.pos_returns where client_uuid='fb600000-0000-4000-8000-000000000001'),'a1c9f1e2-0000-4000-8000-000000000002'::uuid,'approving manager audited');
select is((select stock_quantity from public.products where id='fb100000-0000-4000-8000-000000000001'),3,'approval/retry restocks only once');
select ok(not exists(select 1 from public.pos_returns where client_uuid='fb600000-0000-4000-8000-000000000001' and request_items::text like '%4826%'),'approval PIN not stored in return payload');
update public.pos_users set active=false where id='a1c9f1e2-0000-4000-8000-000000000002';
set local role service_role;
select is(pg_temp.approve()->>'error','invalid_pin','disabled manager cannot approve or recover return');
reset role;
update public.pos_users set active=false where id='a1c9f1e2-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select is((select count(*)::integer from public.pos_quotations),0,'disabled cashier cannot read document tokens');
select throws_ok($$select pg_temp.quote()$$,'42501','not_authorized','disabled cashier cannot create quote');
reset role;
select * from finish();
rollback;
