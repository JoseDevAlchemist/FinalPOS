begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values
 ('fe000000-0000-4000-8000-000000000001','card-cashier@pedigree.local'),
 ('fe000000-0000-4000-8000-000000000002','card-manager@pedigree.local');
update public.pos_users set auth_user_id='fe000000-0000-4000-8000-000000000001' where id='a1c9f1e2-0000-4000-8000-000000000001';
update public.pos_users set auth_user_id='fe000000-0000-4000-8000-000000000002' where id='a1c9f1e2-0000-4000-8000-000000000002';
insert into public.products(id,name,slug,description,category,base_price,active,is_website_published)
 values('fe100000-0000-4000-8000-000000000001','Card bag','card-bag-fixture','','bag',1000,true,false);
insert into public.product_colors(id,product_id,color_name,color_hex,stock_quantity)
 values('fe200000-0000-4000-8000-000000000001','fe100000-0000-4000-8000-000000000001','Tan','#8B4513',2);
create function pg_temp.card_items(p_price integer default 1000) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('product_id','fe100000-0000-4000-8000-000000000001','color_id','fe200000-0000-4000-8000-000000000001','quantity',1,'price_at_sale',p_price));
$$;
create function pg_temp.prepare_card(p_id uuid default 'fe300000-0000-4000-8000-000000000001',p_price integer default 1000) returns jsonb language sql as $$
 select public.pos_prepare_card_sale(p_id,p_price,pg_temp.card_items(p_price));
$$;
select ok(not has_function_privilege('anon','public.pos_prepare_card_sale(uuid,integer,jsonb)','execute'),'anon cannot prepare card sale');
select ok(not has_function_privilege('authenticated','public.pos_finalize_card(uuid,text,text,integer)','execute'),'client cannot forge payment verification');
select ok(not has_table_privilege('authenticated','public.pos_card_payments','update'),'client cannot mark drafts verified');
set local role anon;
select throws_ok($$select * from public.pos_card_payments$$,'42501',null,'anon cannot read payment drafts');
reset role;
select set_config('request.jwt.claim.sub','fe000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok($$select pg_temp.prepare_card('fe300000-0000-4000-8000-000000000001',1)$$,'22023','price_mismatch','client prices cannot reduce card amount');
select is((pg_temp.prepare_card()->>'amount')::integer,1000,'server prices card draft');
select is(pg_temp.prepare_card()->>'tx_ref','POS-CARD-fe300000-0000-4000-8000-000000000001','server binds stable reference to draft');
select is((select count(*)::integer from public.pos_card_payments),1,'prepare retry does not duplicate draft');
select is((select stock_quantity from public.products where id='fe100000-0000-4000-8000-000000000001'),2,'preparing does not decrement stock');
select throws_ok($$select public.pos_record_sale(gen_random_uuid(),'a1c9f1e2-0000-4000-8000-000000000001',1000,'cash',1000,pg_temp.card_items())$$,'23514','card_payment_unresolved','prepared card must be cancelled before cash');
select lives_ok($$select public.pos_mark_card_opened('fe300000-0000-4000-8000-000000000001')$$,'opening recorded before provider modal');
select throws_ok($$select public.pos_cancel_prepared_card('fe300000-0000-4000-8000-000000000001')$$,'23514','card_payment_unresolved','modal close cannot cancel an opened attempt');
select throws_ok($$select public.pos_record_sale('fe300000-0000-4000-8000-000000000001','a1c9f1e2-0000-4000-8000-000000000001',1000,'card',null,pg_temp.card_items())$$,'42501','not_authorized','cashier cannot call card commit directly');
reset role;
-- Catalogue changes after modal opening must not reprice a captured payment.
update public.products set base_price=1500 where id='fe100000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select throws_ok($$select public.pos_finalize_card('fe300000-0000-4000-8000-000000000001','900001','POS-CARD-fe300000-0000-4000-8000-000000000001',999)$$,'22023','card_verification_mismatch','underpayment rejected');
select throws_ok($$select public.pos_finalize_card('fe300000-0000-4000-8000-000000000001','900001','wrong-reference',1000)$$,'22023','card_verification_mismatch','reference mismatch rejected');
select is(public.pos_finalize_card('fe300000-0000-4000-8000-000000000001','900001','POS-CARD-fe300000-0000-4000-8000-000000000001',1000),'completed','verified card finalizes sale');
select is(public.pos_finalize_card('fe300000-0000-4000-8000-000000000001','900001','POS-CARD-fe300000-0000-4000-8000-000000000001',1000),'completed','verification retry recovers sale');
select throws_ok($$select public.pos_finalize_card('fe300000-0000-4000-8000-000000000001','900002','POS-CARD-fe300000-0000-4000-8000-000000000001',1000)$$,'23514','card_evidence_conflict','completed draft cannot attach a different transaction');
reset role;
select is((select total from public.pos_sales where id='fe300000-0000-4000-8000-000000000001'),1000,'historical frozen amount committed');
select is((select payment_method from public.pos_sales where id='fe300000-0000-4000-8000-000000000001'),'card','sale identifies card payment');
select is((select payment_status from public.pos_sales where id='fe300000-0000-4000-8000-000000000001'),'paid','paid status only after verified finalization');
select is((select stock_quantity from public.products where id='fe100000-0000-4000-8000-000000000001'),1,'stock decremented once');
select is((select count(*)::integer from public.stock_movements where product_id='fe100000-0000-4000-8000-000000000001'),1,'one stock ledger movement');
select is((select event from public.pos_sale_audit where sale_id='fe300000-0000-4000-8000-000000000001'),'card_sale_recorded','card sale audit recorded');
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select is((pg_temp.prepare_card('fe300000-0000-4000-8000-000000000002',1500)->>'amount')::integer,1500,'new draft uses current server price');
select lives_ok($$select public.pos_mark_card_opened('fe300000-0000-4000-8000-000000000002')$$,'second hosted attempt recorded');
reset role;
-- Simulate another sale taking the last unit, through the ledger rather than a
-- silent stock overwrite. The capture must stay recoverable without a partial sale.
update public.product_colors set stock_quantity=stock_quantity-1 where id='fe200000-0000-4000-8000-000000000001';
insert into public.stock_movements(product_id,color_id,delta,quantity_after,reason,actor_staff_id)
 values('fe100000-0000-4000-8000-000000000001','fe200000-0000-4000-8000-000000000001',-1,0,'local stock-race fixture','a1c9f1e2-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select is(public.pos_finalize_card('fe300000-0000-4000-8000-000000000002','900003','POS-CARD-fe300000-0000-4000-8000-000000000002',1500),'reconciliation','captured funds survive stock conflict');
reset role;
select is((select count(*)::integer from public.pos_sales where id='fe300000-0000-4000-8000-000000000002'),0,'stock conflict creates no partial paid sale');
select is((select provider_transaction_id from public.pos_card_payments where id='fe300000-0000-4000-8000-000000000002'),'900003','verified provider reference retained for reconciliation');
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok($$select public.pos_record_sale(gen_random_uuid(),'a1c9f1e2-0000-4000-8000-000000000001',1500,'cash',1500,pg_temp.card_items(1500))$$,'23514','card_payment_unresolved','unresolved capture blocks conflicting cash checkout');
reset role;
select set_config('request.jwt.claim.sub','fe000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is(public.pos_manager_adjust_stock(gen_random_uuid(),'fe100000-0000-4000-8000-000000000001','fe200000-0000-4000-8000-000000000001',1,'Restore local stock race fixture'),1,'manager resolves stock with audited adjustment');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select is(public.pos_finalize_card('fe300000-0000-4000-8000-000000000002','900003','POS-CARD-fe300000-0000-4000-8000-000000000002',1500),'completed','same capture finalizes after stock resolution');
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
select is(public.pos_manager_adjust_stock(gen_random_uuid(),'fe100000-0000-4000-8000-000000000001','fe200000-0000-4000-8000-000000000001',1,'Prepare local cancellation fixture'),1,'replenish cancellation fixture through ledger');
select set_config('request.jwt.claim.sub','fe000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select lives_ok($$select pg_temp.prepare_card('fe300000-0000-4000-8000-000000000003',1500)$$,'prepare unstarted draft for cancellation');
select lives_ok($$select public.pos_cancel_prepared_card('fe300000-0000-4000-8000-000000000003')$$,'unstarted draft can be cancelled safely');
select lives_ok($$select public.pos_cancel_prepared_card('fe300000-0000-4000-8000-000000000003')$$,'cancellation retry is idempotent');
reset role;
update public.pos_users set active=false where id='a1c9f1e2-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.prepare_card('fe300000-0000-4000-8000-000000000004',1500)$$,'42501','not_authorized','disabled staff cannot prepare card payments');
select is((select count(*)::integer from public.pos_card_payments),0,'disabled staff cannot read payment drafts');
reset role;
select * from finish();
rollback;
