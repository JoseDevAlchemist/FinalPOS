begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();
insert into auth.users(id,email) values
 ('f8000000-0000-4000-8000-000000000001','returns-cashier@pedigree.local'),
 ('f8000000-0000-4000-8000-000000000002','returns-manager@pedigree.local');
update public.pos_users set auth_user_id='f8000000-0000-4000-8000-000000000001' where id='a1c9f1e2-0000-4000-8000-000000000001';
update public.pos_users set auth_user_id='f8000000-0000-4000-8000-000000000002' where id='a1c9f1e2-0000-4000-8000-000000000002';
-- Historical sale after a 33% rounded discount: 1502 - 496 = 1006.
-- Current catalogue prices deliberately differ from the receipt.
insert into public.products(id,name,slug,description,category,base_price,active,is_website_published)
values('f8100000-0000-4000-8000-000000000001','Return bag fixture','return-bag-fixture','','bag',9000,true,false);
insert into public.product_colors(id,product_id,color_name,color_hex,stock_quantity) values
 ('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001','Tan','#8B4513',8),
 ('f8200000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000001','Black','#000000',9);
insert into public.pos_sales(id,client_uuid,staff_id,staff_name,subtotal,discount_percent,discount_amount,total,payment_method,payment_status) values
 ('f8300000-0000-4000-8000-000000000001','f8300000-0000-4000-8000-000000000001','a1c9f1e2-0000-4000-8000-000000000001','Historical cashier',1502,33,496,1006,'cash','paid'),
 ('f8300000-0000-4000-8000-000000000002','f8300000-0000-4000-8000-000000000002','a1c9f1e2-0000-4000-8000-000000000001','Historical cashier',500,0,0,500,'mpesa','pending'),
 ('f8300000-0000-4000-8000-000000000003','f8300000-0000-4000-8000-000000000003','a1c9f1e2-0000-4000-8000-000000000001','Historical cashier',100,0,0,100,'cash','paid');
insert into public.pos_sale_items(id,sale_id,product_id,color_id,name,color_name,unit_price,quantity,line_total) values
 ('f8400000-0000-4000-8000-000000000001','f8300000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000001','Original bag name','Tan',500,2,1000),
 ('f8400000-0000-4000-8000-000000000002','f8300000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000002','Original bag name','Black',502,1,502),
 ('f8400000-0000-4000-8000-000000000003','f8300000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000001','Unpaid bag','Tan',500,1,500),
 ('f8400000-0000-4000-8000-000000000004','f8300000-0000-4000-8000-000000000003','f8100000-0000-4000-8000-000000000001',null,'Legacy bag',null,100,1,100);
create function pg_temp.return_one(p_uuid uuid default 'f8500000-0000-4000-8000-000000000001',p_quantity integer default 1,p_reason text default 'Wrong size')
returns uuid language sql as $$
 select public.pos_process_return(p_uuid,'f8300000-0000-4000-8000-000000000001',p_reason,
   jsonb_build_array(jsonb_build_object('sale_item_id','f8400000-0000-4000-8000-000000000001','quantity',p_quantity)));
$$;
select ok(not has_function_privilege('anon','public.pos_process_return(uuid,uuid,text,jsonb)','execute'),'anonymous cannot process returns');
select ok(not has_function_privilege('authenticated','public.pos_returnable_items(uuid)','execute'),'historical allocation helper is private');
select ok(not has_table_privilege('authenticated','public.pos_returns','insert'),'direct refund writes denied');
select ok(not has_table_privilege('authenticated','public.pos_returns','update'),'refund history cannot be rewritten');
select ok(not has_table_privilege('authenticated','public.pos_return_items','delete'),'return items cannot be deleted');
set local role anon;
select throws_ok($$select * from public.pos_returns$$,'42501',null,'anon cannot read refunds');
reset role;
select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok($$select pg_temp.return_one()$$,'42501','not_authorized','cashier cannot authorize returns');
select throws_ok($$select public.pos_return_sale_details('f8300000-0000-4000-8000-000000000001')$$,'42501','not_authorized','cashier cannot use return detail RPC');
reset role;
select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select lives_ok($$select pg_temp.return_one()$$,'manager processes partial return');
select is((select refund_amount from public.pos_returns where client_uuid='f8500000-0000-4000-8000-000000000001'),334,'refund uses original discount allocation, not current price');
select is((select stock_quantity from public.product_colors where id='f8200000-0000-4000-8000-000000000001'),9,'original Tan stock increments');
select is((select stock_quantity from public.product_colors where id='f8200000-0000-4000-8000-000000000002'),9,'other colour unchanged');
select is((select stock_quantity from public.products where id='f8100000-0000-4000-8000-000000000001'),18,'products stock projection increments once');
select is((select processed_by from public.pos_returns where client_uuid='f8500000-0000-4000-8000-000000000001'),'a1c9f1e2-0000-4000-8000-000000000002'::uuid,'server-derived manager identity recorded');
select is(pg_temp.return_one(),(select id from public.pos_returns where client_uuid='f8500000-0000-4000-8000-000000000001'),'lost response retry returns same return ID');
select is((select count(*)::integer from public.pos_returns where sale_id='f8300000-0000-4000-8000-000000000001'),1,'one refund after replay');
select is((select stock_quantity from public.products where id='f8100000-0000-4000-8000-000000000001'),18,'replay cannot double restock');
select is((select count(*)::integer from public.stock_movements where reference_uuid=(select id from public.pos_returns where client_uuid='f8500000-0000-4000-8000-000000000001')),1,'one auditable movement per returned line');
select throws_ok($$select pg_temp.return_one('f8500000-0000-4000-8000-000000000001',1,'Changed reason')$$,'22023','idempotency_mismatch','replay cannot change reason');
select throws_ok($$select pg_temp.return_one('f8500000-0000-4000-8000-000000000002',2)$$,'23514','return_quantity_exceeded','prior returns reduce remaining quantity');
select throws_ok($$select public.pos_process_return(gen_random_uuid(),'f8300000-0000-4000-8000-000000000001','Mixed request',
 '[{"sale_item_id":"f8400000-0000-4000-8000-000000000002","quantity":1},{"sale_item_id":"f8400000-0000-4000-8000-000000000003","quantity":1}]')$$,'22023','item_not_in_sale','foreign sale line rejects whole request');
select is((select stock_quantity from public.products where id='f8100000-0000-4000-8000-000000000001'),18,'rejected mixed return has no stock effects');
select throws_ok($$select public.pos_process_return(gen_random_uuid(),'f8300000-0000-4000-8000-000000000002','Unpaid',
 '[{"sale_item_id":"f8400000-0000-4000-8000-000000000003","quantity":1}]')$$,'22023','sale_not_paid','unpaid sales cannot be refunded');
select throws_ok($$select pg_temp.return_one(gen_random_uuid(),0)$$,'22023','invalid_return_items','zero quantity rejected');
select throws_ok($$select public.pos_process_return(gen_random_uuid(),'f8300000-0000-4000-8000-000000000001','Duplicate',
 '[{"sale_item_id":"f8400000-0000-4000-8000-000000000001","quantity":1},{"sale_item_id":"f8400000-0000-4000-8000-000000000001","quantity":1}]')$$,'22023','invalid_return_items','duplicate line cannot bypass caps');
select throws_ok($$select public.pos_process_return(gen_random_uuid(),'f8300000-0000-4000-8000-000000000003','Missing colour',
 '[{"sale_item_id":"f8400000-0000-4000-8000-000000000004","quantity":1}]')$$,'23514','original_color_missing','legacy colour is never guessed');
select lives_ok($$select pg_temp.return_one('f8500000-0000-4000-8000-000000000002')$$,'second partial return succeeds');
select is((select refund_amount from public.pos_returns where client_uuid='f8500000-0000-4000-8000-000000000002'),335,'last unit receives integer rounding remainder');
select lives_ok($$select public.pos_process_return('f8500000-0000-4000-8000-000000000003','f8300000-0000-4000-8000-000000000001','Customer request',
 '[{"sale_item_id":"f8400000-0000-4000-8000-000000000002","quantity":1}]')$$,'remaining colour can be returned');
select is((select sum(refund_amount)::integer from public.pos_returns where sale_id='f8300000-0000-4000-8000-000000000001'),1006,'full return refunds exact original paid total');
select is((select total from public.pos_sales where id='f8300000-0000-4000-8000-000000000001'),1006,'historical sale total unchanged');
select is((select line_total from public.pos_sale_items where id='f8400000-0000-4000-8000-000000000001'),1000,'historical line unchanged');
select is((select stock_quantity from public.products where id='f8100000-0000-4000-8000-000000000001'),20,'both colours restored to product stock');
select throws_ok($$select pg_temp.return_one(gen_random_uuid())$$,'23514','return_quantity_exceeded','fully returned sale cannot refund again');
select is((public.pos_return_sale_details('f8300000-0000-4000-8000-000000000001')->'items'->0->>'returned_quantity')::integer,2,'read preview includes committed returns');
reset role;
select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select count(*)::integer from public.pos_returns),0,'cashier cannot read refund audit');
select is((select count(*)::integer from public.pos_return_items),0,'cashier cannot read return items');
reset role;
update public.pos_users set active=false where id='a1c9f1e2-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok($$select pg_temp.return_one()$$,'42501','not_authorized','disabled manager cannot retry or authorize');
select is((select count(*)::integer from public.pos_returns),0,'disabled manager cannot read refund audit');
reset role;
select * from finish();
rollback;
