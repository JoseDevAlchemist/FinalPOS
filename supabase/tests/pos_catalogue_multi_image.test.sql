begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

-- Introduce only the storefront columns absent from the standalone test stack.
create table if not exists public.categories (
  id uuid primary key, name text not null, slug text not null unique,
  parent_id uuid references public.categories(id), is_active boolean not null default true
);
alter table public.products
  add column if not exists category_id uuid references public.categories(id),
  add column if not exists base_price_usd integer,
  add column if not exists publish_to_pos boolean not null default true;
alter table public.products alter column publish_to_pos set default false;
alter function public.pos_manager_save_catalogue_product(uuid,jsonb)
  set pos.catalogue_storage_origin = 'https://catalogue-fixture.example';
insert into storage.objects (bucket_id, name)
select 'product-images', product_id || '/' || file_name
from unnest(array['cc900000-0000-4000-8000-000000000005','cc900000-0000-4000-8000-000000000006']) product_id
cross join unnest(array['front.webp','laces.png','replacement.webp']) file_name;
grant select (category_id) on public.products to anon;
insert into public.categories (id, name, slug)
  values ('cc900000-0000-4000-8000-000000000001', 'Shoes', 'shoes') on conflict (slug) do nothing;
insert into public.categories (id, name, slug, parent_id)
  select 'cc900000-0000-4000-8000-000000000002', 'Catalogue test shoes', 'catalogue-test-shoes', id
  from public.categories where slug = 'shoes';

insert into auth.users (id, email) values
  ('cc900000-0000-4000-8000-000000000003', 'catalogue-manager@pedigree.local'),
  ('cc900000-0000-4000-8000-000000000004', 'catalogue-cashier@pedigree.local');
update public.pos_users set auth_user_id = 'cc900000-0000-4000-8000-000000000003'
  where id = 'a1c9f1e2-0000-4000-8000-000000000002';
update public.pos_users set auth_user_id = 'cc900000-0000-4000-8000-000000000004'
  where id = 'a1c9f1e2-0000-4000-8000-000000000001';

create function pg_temp.product_payload(p_published boolean, p_id text default 'cc900000-0000-4000-8000-000000000005') returns jsonb language sql as $$
  select jsonb_build_object(
    'name', 'Catalogue SQL test', 'description', 'A short product description.', 'category', 'bag',
    'categoryId', 'cc900000-0000-4000-8000-000000000002',
    'basePrice', 4000, 'basePriceUsd', 39, 'discountPercent', 10,
    'isWebsitePublished', p_published,
    'colors', replace('[
      {"name":"Tan","hex":"#8B4513","stockQuantity":3,"images":[
        {"angle":"front","imageUrl":"https://catalogue-fixture.example/storage/v1/object/public/product-images/PRODUCT/front.webp"},
        {"angle":"laces","imageUrl":"https://catalogue-fixture.example/storage/v1/object/public/product-images/PRODUCT/laces.png"}
      ]},
      {"name":"Black","hex":"#000000","stockQuantity":2,"images":[]}
    ]', 'PRODUCT', p_id)::jsonb
  );
$$;

select ok(not has_function_privilege('anon','public.pos_manager_save_catalogue_product(uuid,jsonb)','execute'),
  'anonymous users cannot call the RPC');
select ok(not has_function_privilege('service_role','public.pos_manager_save_catalogue_product(uuid,jsonb)','execute'),
  'service role has no direct catalogue RPC grant');
select set_config('request.jwt.claim.sub','cc900000-0000-4000-8000-000000000004',true);
set local role authenticated;
select throws_ok($$select public.pos_manager_save_catalogue_product(gen_random_uuid(), pg_temp.product_payload(false))$$,
  '42501', 'not_authorized', 'cashier cannot create products');
reset role;

select set_config('request.jwt.claim.sub','cc900000-0000-4000-8000-000000000003',true);
set local role authenticated;
select throws_ok($$select public.pos_manager_save_catalogue_product(
  'cc900000-0000-4000-8000-000000000008', pg_temp.product_payload(true) - 'categoryId')$$,
  '22023', 'category_required', 'publication requires an assigned category');
select throws_ok($$select public.pos_manager_save_catalogue_product(
  'cc900000-0000-4000-8000-000000000008', jsonb_set(pg_temp.product_payload(true), '{discountPercent}', '100'))$$,
  '22023', 'storefront_product_limits', 'new publication rejects a discount the storefront would ignore');
select set_config('pos.catalogue_storage_origin','https://other-project.example',true);
select throws_ok($$select public.pos_manager_save_catalogue_product(
  'cc900000-0000-4000-8000-000000000005', jsonb_set(pg_temp.product_payload(false), '{colors,0,images,0,imageUrl}',
  '"https://other-project.example/storage/v1/object/public/product-images/cc900000-0000-4000-8000-000000000005/front.webp"'))$$,
  '22023', 'invalid_image_url', 'a different host cannot reference a real object key');
select throws_ok($$select public.pos_manager_save_catalogue_product(
  'cc900000-0000-4000-8000-000000000005', jsonb_set(pg_temp.product_payload(false), '{colors,0,images,0,imageUrl}',
  '"https://catalogue-fixture.example/storage/v1/object/public/product-images/cc900000-0000-4000-8000-000000000005/missing.webp"'))$$,
  '22023', 'invalid_image_url', 'a missing bucket object cannot be registered');
select throws_ok($$select public.pos_manager_save_catalogue_product(
  'cc900000-0000-4000-8000-000000000005', jsonb_set(pg_temp.product_payload(false), '{colors,0,images,0,imageUrl}',
  '"https://catalogue-fixture.example/storage/v1/object/public/product-images/cc900000-0000-4000-8000-000000000005/%2e%2e/front.webp"'))$$,
  '22023', 'invalid_image_url', 'encoded traversal cannot be registered');
select is(public.pos_manager_save_catalogue_product('cc900000-0000-4000-8000-000000000005', pg_temp.product_payload(true)),
  'cc900000-0000-4000-8000-000000000005'::uuid, 'manager publishes the product');
select is(public.pos_manager_save_catalogue_product('cc900000-0000-4000-8000-000000000005', pg_temp.product_payload(true)),
  'cc900000-0000-4000-8000-000000000005'::uuid, 'idempotent create replay');
select throws_ok($$select public.pos_manager_save_catalogue_product(
  'cc900000-0000-4000-8000-000000000005', pg_temp.product_payload(false))$$,
  '22023', 'idempotency_mismatch', 'changed details cannot replay over a committed product');
select is(public.pos_manager_save_catalogue_product('cc900000-0000-4000-8000-000000000006', pg_temp.product_payload(false, 'cc900000-0000-4000-8000-000000000006')),
  'cc900000-0000-4000-8000-000000000006'::uuid, 'manager can save a draft');
reset role;

select ok((select publish_to_pos and active and not is_website_published from public.products
  where id = 'cc900000-0000-4000-8000-000000000006'),
  'a new website draft is active and POS-visible even with a false column default');
update public.products set publish_to_pos = false
  where id = 'cc900000-0000-4000-8000-000000000005';

create temporary table original_variants as
  select id, color_name, stock_quantity from public.product_colors
  where product_id = 'cc900000-0000-4000-8000-000000000005';
grant select on original_variants to authenticated;

select results_eq($$select category, category_id, base_price_usd, discount_percent from public.products
  where id = 'cc900000-0000-4000-8000-000000000005'$$,
  $$values ('shoe'::text, 'cc900000-0000-4000-8000-000000000002'::uuid, 39, 10)$$,
  'subcategory determines the legacy product route and USD and discount are preserved');
select results_eq($$select angle, sort_order from public.product_images
  where color_id = (select id from original_variants where color_name = 'Tan')
  order by sort_order$$, $$values ('front'::text, 0), ('laces'::text, 1)$$,
  'mixed WebP and PNG metadata belongs to the Tan variant in angle order');
select is((select count(*) from public.product_images where color_id = (select id from original_variants where color_name = 'Black')),
  0::bigint, 'the other colour may have no photos');
select is((select sum(delta) from public.stock_movements where product_id = 'cc900000-0000-4000-8000-000000000005'),
  5::bigint, 'replay does not duplicate stock movements');
select is((select stock_quantity from public.products where id = 'cc900000-0000-4000-8000-000000000005'),
  5, 'the existing aggregate stock projection agrees with the colour movements');
select is((select count(*) from public.pos_stock_adjustments where product_id = 'cc900000-0000-4000-8000-000000000005'),
  2::bigint, 'the opening stock audit records both variants once');

select set_config('request.jwt.claim.sub','',true);
set local role anon;
select is((select count(*) from public.products where category_id = 'cc900000-0000-4000-8000-000000000002'
  and id in ('cc900000-0000-4000-8000-000000000005','cc900000-0000-4000-8000-000000000006')),
  1::bigint, 'the anonymous category sees the published product while the draft remains private');
reset role;

update public.products set active = false where id = 'cc900000-0000-4000-8000-000000000005';
insert into public.product_images (color_id, angle, image_url, sort_order)
select id, 'back', 'https://legacy.example/catalogue.jpg?v=1', 0 from original_variants where color_name = 'Black';

create function pg_temp.edit_payload() returns jsonb language sql as $$
  select pg_temp.product_payload(false) || jsonb_build_object(
    'productId','cc900000-0000-4000-8000-000000000005', 'basePriceUsd', null,
    'colors', (select jsonb_agg(jsonb_build_object(
      'id', id, 'name', color_name, 'hex', '#000000', 'images',
      case when color_name = 'Tan'
        then '[{"angle":"front","imageUrl":"https://catalogue-fixture.example/storage/v1/object/public/product-images/cc900000-0000-4000-8000-000000000005/replacement.webp"}]'::jsonb else '[{"angle":"back","imageUrl":"https://legacy.example/catalogue.jpg?v=1"}]'::jsonb end
    ) order by color_name) from original_variants)
  );
$$;

select set_config('request.jwt.claim.sub','cc900000-0000-4000-8000-000000000003',true);
set local role authenticated;
select is(public.pos_manager_save_catalogue_product('cc900000-0000-4000-8000-000000000007', pg_temp.edit_payload()),
  'cc900000-0000-4000-8000-000000000005'::uuid, 'edit replaces and removes photo metadata');
select is(public.pos_manager_save_catalogue_product('cc900000-0000-4000-8000-000000000007', pg_temp.edit_payload()),
  'cc900000-0000-4000-8000-000000000005'::uuid, 'edit can be safely retried');
select throws_ok($$select public.pos_manager_save_catalogue_product(
  'cc900000-0000-4000-8000-000000000008',
  jsonb_set(pg_temp.edit_payload(), '{colors,0,images}', '[{"angle":"front","imageUrl":"blob:preview"}]'))$$,
  '22023', 'invalid_image_url', 'browser preview URLs cannot be stored');
select throws_ok($$select public.pos_manager_save_catalogue_product(
  'cc900000-0000-4000-8000-000000000009',
  jsonb_set(pg_temp.edit_payload(), '{colors}', (pg_temp.edit_payload()->'colors') - 0))$$,
  '23514', 'color_has_stock', 'a variant with stock cannot be removed by editing');
reset role;

select results_eq($$select id, color_name, stock_quantity from public.product_colors
  where product_id = 'cc900000-0000-4000-8000-000000000005' order by id$$,
  $$select * from original_variants order by id$$, 'edit preserves colour IDs and live stock');
select results_eq($$select angle, image_url from public.product_images
  where color_id = (select id from original_variants where color_name = 'Tan')$$,
  $$values ('front'::text, 'https://catalogue-fixture.example/storage/v1/object/public/product-images/cc900000-0000-4000-8000-000000000005/replacement.webp'::text)$$,
  'replacement and removal affect only the selected slots');
select is((select count(*) from public.pos_management_events where client_uuid = 'cc900000-0000-4000-8000-000000000007'),
  1::bigint, 'edit replay leaves one audit event');
select is((select base_price_usd from public.products where id = 'cc900000-0000-4000-8000-000000000005'),
  null::integer, 'USD override can be cleared');

select ok((select not publish_to_pos and not active and not is_website_published from public.products
  where id = 'cc900000-0000-4000-8000-000000000005'), 'website unpublish preserves active and POS publication');
select is((select image_url from public.product_images
  where color_id = (select id from original_variants where color_name = 'Black') and angle = 'back'),
  'https://legacy.example/catalogue.jpg?v=1', 'existing legacy URL stays on its original variant');

-- A zero-stock colour referenced only by the return line exercises the return
-- check independently of the sale-line check. The fixture preserves both FK rows.
insert into public.product_colors (id, product_id, color_name, color_hex, stock_quantity)
values ('cc900000-0000-4000-8000-000000000020','cc900000-0000-4000-8000-000000000005','Olive','#778855',0);
insert into public.pos_sales (id,client_uuid,staff_id,staff_name,subtotal,total,payment_method,payment_status)
values ('cc900000-0000-4000-8000-000000000021',gen_random_uuid(),'a1c9f1e2-0000-4000-8000-000000000001','Fixture cashier',100,100,'cash','paid');
insert into public.pos_sale_items (id,sale_id,product_id,color_id,name,color_name,unit_price,quantity,line_total)
select 'cc900000-0000-4000-8000-000000000022','cc900000-0000-4000-8000-000000000021',
  'cc900000-0000-4000-8000-000000000005',id,'Fixture product','Tan',100,1,100
from original_variants where color_name = 'Tan';
insert into public.pos_returns (id,client_uuid,sale_id,processed_by,processed_by_name,refund_amount,reason,request_items)
values ('cc900000-0000-4000-8000-000000000023',gen_random_uuid(),'cc900000-0000-4000-8000-000000000021',
  'a1c9f1e2-0000-4000-8000-000000000002','Fixture manager',100,'Fixture return','[]');
insert into public.pos_return_items (return_id,sale_item_id,product_id,color_id,product_name,color_name,quantity,refund_amount)
values ('cc900000-0000-4000-8000-000000000023','cc900000-0000-4000-8000-000000000022',
  'cc900000-0000-4000-8000-000000000005','cc900000-0000-4000-8000-000000000020','Fixture product','Olive',1,100);

set local role authenticated;
select throws_ok($$select public.pos_manager_save_catalogue_product(
  'cc900000-0000-4000-8000-000000000024', pg_temp.edit_payload() || '{"name":"Should roll back","active":true}')$$,
  '23514', 'color_has_history', 'zero-stock colour with a return cannot be removed');
reset role;
select is((select color_id from public.pos_return_items where return_id = 'cc900000-0000-4000-8000-000000000023'),
  'cc900000-0000-4000-8000-000000000020'::uuid, 'rejected removal preserves the historical reference');
select ok((select name = 'Catalogue SQL test' and not active and stock_quantity = 5 from public.products
  where id = 'cc900000-0000-4000-8000-000000000005'), 'late failure rolls back product changes and preserves stock');
select ok(not exists (select 1 from public.pos_management_events
  where client_uuid = 'cc900000-0000-4000-8000-000000000024'), 'late failure rolls back the request claim');

-- Use a separate draft to exercise JSON and discovered foreign keys without
-- the return fixture masking these guards.
insert into public.product_colors (id, product_id, color_name, color_hex, stock_quantity)
values ('cc900000-0000-4000-8000-000000000025','cc900000-0000-4000-8000-000000000006','Olive','#778855',0);
insert into public.pos_card_payments (id, tx_ref, staff_id, amount, items)
values ('cc900000-0000-4000-8000-000000000026','catalogue-fixture',
  'a1c9f1e2-0000-4000-8000-000000000001',100,
  '[{"color_id":"cc900000-0000-4000-8000-000000000025"}]');
create function pg_temp.edit_draft() returns jsonb language sql as $$
  select pg_temp.product_payload(false) || jsonb_build_object(
    'productId','cc900000-0000-4000-8000-000000000006',
    'colors', (select jsonb_agg(jsonb_build_object('id',id,'name', color_name,'hex',color_hex,'images','[]'::jsonb))
      from public.product_colors where product_id = 'cc900000-0000-4000-8000-000000000006'
        and color_name <> 'Olive')
  );
$$;
set local role authenticated;
select throws_ok($$select public.pos_manager_save_catalogue_product(gen_random_uuid(), pg_temp.edit_draft())$$,
  '23514', 'color_has_history', 'a JSON payment snapshot protects its colour');
reset role;
delete from public.pos_card_payments where id = 'cc900000-0000-4000-8000-000000000026';
create table public.catalogue_history_fixture (
  product uuid,
  colour_name text,
  foreign key (product, colour_name) references public.product_colors(product_id, color_name) on delete cascade
);
insert into public.catalogue_history_fixture values ('cc900000-0000-4000-8000-000000000006', 'Olive');
set local role authenticated;
select throws_ok($$select public.pos_manager_save_catalogue_product(gen_random_uuid(), pg_temp.edit_draft())$$,
  '23514', 'color_has_history', 'an additional cascade FK protects the colour');
reset role;
select is((select count(*) from public.catalogue_history_fixture), 1::bigint, 'the cascade target is untouched');
delete from public.catalogue_history_fixture;
set local role authenticated;
select lives_ok($$select public.pos_manager_save_catalogue_product(gen_random_uuid(), pg_temp.edit_draft())$$,
  'a zero-stock colour with no references can be removed');
reset role;

update public.products set stock_quantity = 6 where id = 'cc900000-0000-4000-8000-000000000006';
set local role authenticated;
select throws_ok($$select public.pos_manager_save_catalogue_product(
  gen_random_uuid(), pg_temp.edit_draft() || '{"name":"Stock drift edit"}')$$,
  '23514', 'catalogue_stock_projection_mismatch', 'a stale aggregate aborts the save instead of silently rewriting stock');
reset role;
select is((select name from public.products where id = 'cc900000-0000-4000-8000-000000000006'),
  'Catalogue SQL test', 'stock mismatch rolls back metadata changes');

update public.pos_users set active = false where id = 'a1c9f1e2-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.pos_manager_save_catalogue_product(
  'cc900000-0000-4000-8000-000000000007', pg_temp.edit_payload())$$,
  '42501', 'not_authorized', 'a disabled manager cannot replay a prior save');
reset role;

select * from finish();
rollback;
