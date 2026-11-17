begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

insert into auth.users(id,email) values
 ('f7000000-0000-4000-8000-000000000001','publishing-cashier@pedigree.local'),
 ('f7000000-0000-4000-8000-000000000002','publishing-manager@pedigree.local');
update public.pos_users set auth_user_id='f7000000-0000-4000-8000-000000000001'
 where id='a1c9f1e2-0000-4000-8000-000000000001';
update public.pos_users set auth_user_id='f7000000-0000-4000-8000-000000000002'
 where id='a1c9f1e2-0000-4000-8000-000000000002';

create function pg_temp.publish_create(p_id uuid, p_published boolean default false)
returns uuid language sql as $$
 select public.pos_manager_create_product(p_id, jsonb_build_object(
   'name','Publishing bag fixture', 'category','bag', 'basePrice',3500,
   'description','Shared catalogue fixture', 'barcode',p_id::text,
   'isWebsitePublished',p_published,
   'colors',jsonb_build_array(jsonb_build_object(
     'name','Tan','hex','#8B4513','stockQuantity',3,'imageUrl','https://example.com/bag.png'
   ))
 ));
$$;
create function pg_temp.publish_adjust(p_uuid uuid, p_delta integer)
returns integer language sql as $$
 select public.pos_manager_adjust_stock(p_uuid,'f7100000-0000-4000-8000-000000000001',
   (select id from public.product_colors where product_id='f7100000-0000-4000-8000-000000000001'),
   p_delta,'Found in store');
$$;
create function pg_temp.publish_edit(p_published boolean)
returns uuid language sql as $$
 select public.pos_manager_update_product(
   'f7100000-0000-4000-8000-000000000001','Edited bag fixture','Edited description','bag',4000,0,
   'EDITED-PUBLISHING-BAG',true,p_published,
   (select jsonb_agg(jsonb_build_object('id',id,'name',color_name,'hex',color_hex,'images','[]'::jsonb))
      from public.product_colors where product_id='f7100000-0000-4000-8000-000000000001')
 );
$$;

select ok(not has_function_privilege('anon','public.pos_manager_create_product(uuid,jsonb)','execute'),'anon cannot create');
select ok(not has_function_privilege('authenticated','public.pos_audit_stock_adjustment()','execute'),'audit trigger is private');
select ok(not has_table_privilege('authenticated','public.pos_stock_adjustments','insert'),'staff cannot forge audit rows');
select ok(not has_table_privilege('authenticated','public.pos_stock_adjustments','update'),'staff cannot rewrite audit rows');
select ok(not has_table_privilege('authenticated','public.pos_stock_adjustments','delete'),'staff cannot erase audit rows');

select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is(pg_temp.publish_create('f7100000-0000-4000-8000-000000000001',true),'f7100000-0000-4000-8000-000000000001'::uuid,'manager creates published bag');
select is(pg_temp.publish_create('f7100000-0000-4000-8000-000000000001',true),'f7100000-0000-4000-8000-000000000001'::uuid,'creation replay is safe');
select throws_ok($$select pg_temp.publish_create('f7100000-0000-4000-8000-000000000001',false)$$,'22023','idempotency_mismatch','replay cannot change publication flag');
select ok((select is_website_published from public.products where id='f7100000-0000-4000-8000-000000000001'),'publication saved on shared products');
select is((select count(*)::integer from public.pos_stock_adjustments where product_id='f7100000-0000-4000-8000-000000000001'),1,'opening stock audited once');
select is((select quantity_before from public.pos_stock_adjustments where product_id='f7100000-0000-4000-8000-000000000001'),0,'opening quantity starts at zero');
select is(pg_temp.publish_adjust('f7200000-0000-4000-8000-000000000001',2),5,'positive adjustment commits');
select is(pg_temp.publish_adjust('f7200000-0000-4000-8000-000000000001',2),5,'adjustment replay is safe');
select is((select count(*)::integer from public.pos_stock_adjustments where reference_uuid='f7200000-0000-4000-8000-000000000001'),1,'adjustment audited once');
select is((select actor_staff_id from public.pos_stock_adjustments where reference_uuid='f7200000-0000-4000-8000-000000000001'),'a1c9f1e2-0000-4000-8000-000000000002'::uuid,'audit actor comes from manager identity');
select is(pg_temp.publish_adjust('f7200000-0000-4000-8000-000000000002',-1),4,'negative adjustment commits');
select throws_ok($$select pg_temp.publish_adjust('f7200000-0000-4000-8000-000000000003',-5)$$,'23514','invalid_color_or_insufficient_stock','negative stock rejected');
select is((select count(*)::integer from public.pos_stock_adjustments where reference_uuid='f7200000-0000-4000-8000-000000000003'),0,'failed adjustment leaves no audit');
select is(pg_temp.publish_create('f7100000-0000-4000-8000-000000000002'),'f7100000-0000-4000-8000-000000000002'::uuid,'manager creates draft bag');
select ok(not (select is_website_published from public.products where id='f7100000-0000-4000-8000-000000000002'),'draft flag persisted');
reset role;

select set_config('request.jwt.claim.sub','',true);
set local role anon;
select is((select count(*)::integer from public.products where id='f7100000-0000-4000-8000-000000000001'),1,'storefront can read published bag');
select is((select count(*)::integer from public.products where id='f7100000-0000-4000-8000-000000000002'),0,'storefront cannot read draft bag');
select throws_ok($$select * from public.pos_stock_adjustments$$,'42501',null,'anonymous cannot read adjustment audit');
reset role;
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok($$select pg_temp.publish_create('f7100000-0000-4000-8000-000000000003',true)$$,'42501','not_authorized','cashier cannot create published product');
select throws_ok($$select pg_temp.publish_adjust(gen_random_uuid(),1)$$,'42501','not_authorized','cashier cannot adjust stock');
select throws_ok($$select pg_temp.publish_edit(false)$$,'42501','not_authorized','cashier cannot edit visibility');
select is((select count(*)::integer from public.pos_stock_adjustments),0,'cashier cannot read audit rows');
reset role;
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is(pg_temp.publish_edit(false),'f7100000-0000-4000-8000-000000000001'::uuid,'manager unpublishes and edits product');
select is((select base_price from public.products where id='f7100000-0000-4000-8000-000000000001'),4000,'updated KES price saved in products');
select is((select sum(stock_quantity)::integer from public.product_colors where product_id='f7100000-0000-4000-8000-000000000001'),4,'editing metadata preserves stock');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select is((select count(*)::integer from public.products where id='f7100000-0000-4000-8000-000000000001'),0,'unpublish immediately hides database row from storefront role');
reset role;
update public.pos_users set active=false where id='a1c9f1e2-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok($$select pg_temp.publish_edit(true)$$,'42501','not_authorized','disabled manager cannot publish');
select is((select count(*)::integer from public.pos_stock_adjustments),0,'disabled manager cannot read adjustment audit');
reset role;
select * from finish();
rollback;
