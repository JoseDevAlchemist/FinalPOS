begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) values
 ('f0000000-0000-4000-8000-000000000001','manager-test-cashier@pedigree.local','{}'),
 ('f0000000-0000-4000-8000-000000000002','manager-test-manager@pedigree.local','{}'),
 ('f0000000-0000-4000-8000-000000000003','pos-f0000000-0000-4000-8000-000000000003@pedigree.local','{"pos_managed":true}'),
 ('f0000000-0000-4000-8000-000000000004','pos-f0000000-0000-4000-8000-000000000004@pedigree.local','{"pos_managed":true}');
update pos_users set auth_user_id='f0000000-0000-4000-8000-000000000001' where id='a1c9f1e2-0000-4000-8000-000000000001';
update pos_users set auth_user_id='f0000000-0000-4000-8000-000000000002' where id='a1c9f1e2-0000-4000-8000-000000000002';
create function pg_temp.create_product(p_price integer default 3500) returns uuid language sql as $$
 select public.pos_manager_create_product('f2000000-0000-4000-8000-000000000001',
 jsonb_build_object('name','Management SQL fixture','category','bag','basePrice',p_price,'barcode','SQL-MGT-FIXTURE','description','',
 'colors',jsonb_build_array(jsonb_build_object('name','Blue','hex','#0000FF','stockQuantity',3,'imageUrl','/pedigree-logo.png'))));
$$;
create function pg_temp.adjust(p_uuid uuid default 'f2000000-0000-4000-8000-000000000002',p_delta integer default 2) returns integer language sql as $$
 select public.pos_manager_adjust_stock(p_uuid,'f2000000-0000-4000-8000-000000000001',
 (select id from public.product_colors where product_id='f2000000-0000-4000-8000-000000000001'),p_delta,'delivery');
$$;
create function pg_temp.cashier(p_id uuid default 'f0000000-0000-4000-8000-000000000003',p_pin text default '8429') returns uuid language sql as $$
 select public.pos_manager_create_cashier(p_id,p_id,'SQL cashier fixture',p_pin);
$$;
select ok(not has_function_privilege('anon','public.pos_manager_create_product(uuid,jsonb)','execute'),'anon cannot create products');
select ok(not has_function_privilege('authenticated','public.pos_claim_management_request(uuid,text,jsonb)','execute'),'internal request helper is private');
set local role anon;
select throws_ok($$select * from public.pos_management_events$$,'42501',null,'anon cannot read management audit');
reset role;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok($$select pg_temp.create_product()$$,'42501','not_authorized','cashier cannot create products');
select throws_ok($$select pg_temp.adjust()$$,'42501','not_authorized','cashier cannot adjust inventory');
select throws_ok($$select pg_temp.cashier()$$,'42501','not_authorized','cashier cannot provision staff');
select throws_ok($$select public.pos_manager_dashboard()$$,'42501','not_authorized','cashier cannot read overview RPC');
select is((select count(*)::integer from public.pos_management_events),0,'cashier cannot read audit');
reset role;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is(pg_temp.create_product(),'f2000000-0000-4000-8000-000000000001'::uuid,'manager creates product');
select is(pg_temp.create_product(),'f2000000-0000-4000-8000-000000000001'::uuid,'product replay returns original');
select throws_ok($$select pg_temp.create_product(4000)$$,'22023','idempotency_mismatch','changed request cannot reuse UUID');
select is((select count(*)::integer from public.products where id='f2000000-0000-4000-8000-000000000001'),1,'one product after replay');
select is((select stock_quantity from public.products where id='f2000000-0000-4000-8000-000000000001'),3,'initial stock projection');
select is((select count(*)::integer from public.stock_movements where product_id='f2000000-0000-4000-8000-000000000001'),1,'opening stock writes one movement');
select is(pg_temp.adjust(),5,'positive stock adjustment');
select is(pg_temp.adjust(),5,'stock retry returns original quantity');
select is((select stock_quantity from public.products where id='f2000000-0000-4000-8000-000000000001'),5,'stock changes only once');
select is((select count(*)::integer from public.stock_movements where reference_uuid='f2000000-0000-4000-8000-000000000002'),1,'adjustment carries unique request reference');
select throws_ok($$select pg_temp.adjust(gen_random_uuid(),-6)$$,'23514','invalid_color_or_insufficient_stock','negative stock rejected');
select is((select stock_quantity from public.products where id='f2000000-0000-4000-8000-000000000001'),5,'rejected adjustment rolls back');
select is(pg_temp.cashier(),'f0000000-0000-4000-8000-000000000003'::uuid,'linked cashier created');
select is(pg_temp.cashier(),'f0000000-0000-4000-8000-000000000003'::uuid,'cashier replay safe');
select throws_ok($$select pg_temp.cashier('f0000000-0000-4000-8000-000000000004','1234')$$,'23505','pin_in_use','active duplicate PIN rejected');
select is((select role from public.pos_users where id='f0000000-0000-4000-8000-000000000003'),'cashier','role is fixed to cashier');
select throws_ok($$select pin_hash from public.pos_users$$,'42501',null,'even managers cannot read PIN hashes');
select ok(not exists(select 1 from public.pos_management_events where client_uuid='f0000000-0000-4000-8000-000000000003' and (payload::text like '%8429%' or payload::text like '%pin%')),'audit contains no PIN or verifier');
reset role;
select ok((select extensions.crypt('8429',pin_hash)=pin_hash from public.pos_users where id='f0000000-0000-4000-8000-000000000003'),'server stored a valid bcrypt verifier');
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is(public.pos_record_sale(gen_random_uuid(),'a1c9f1e2-0000-4000-8000-000000000001',3500,'cash',3500,
  (select jsonb_build_array(jsonb_build_object('product_id',product_id,'color_id',id,'quantity',1,'price_at_sale',3500)) from public.product_colors where product_id='f2000000-0000-4000-8000-000000000001')),true,'cashier sells new product');
reset role;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is(public.pos_manager_update_product('f2000000-0000-4000-8000-000000000001','Edited management fixture','','bag',4000,0,'SQL-MGT-FIXTURE',true,false,
 (select jsonb_build_array(jsonb_build_object('id',id,'name',color_name,'hex',color_hex,'images','[]'::jsonb)) from public.product_colors where product_id='f2000000-0000-4000-8000-000000000001')),
 'f2000000-0000-4000-8000-000000000001'::uuid,'product with historical sale can be edited');
select is((select stock_quantity from public.products where id='f2000000-0000-4000-8000-000000000001'),4,'editing preserves stock');
select is((select unit_price from public.pos_sale_items where product_id='f2000000-0000-4000-8000-000000000001'),3500,'editing does not reprice history');
select ok((public.pos_manager_dashboard()->>'todayCount')::integer>0,'overview includes committed paid sales');
select throws_ok($$insert into public.pos_management_events(client_uuid,actor_staff_id,kind,payload) values(gen_random_uuid(),'a1c9f1e2-0000-4000-8000-000000000002','product_updated','{}')$$,'42501',null,'direct audit insertion denied');
reset role;
update public.pos_users set active=false where id='a1c9f1e2-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select pg_temp.create_product()$$,'42501','not_authorized','disabled manager denied');
select is((select count(*)::integer from public.pos_management_events),0,'disabled manager loses audit access');
reset role;
select * from finish();
rollback;
