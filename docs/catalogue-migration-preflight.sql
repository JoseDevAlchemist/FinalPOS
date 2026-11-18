-- Read-only, intended for an approved schema review or isolated staging.
begin read only;

-- Definitions and permissions to compare against the reviewed repository.
select p.oid::regprocedure as function, p.proowner::regrole as owner,
  p.prosecdef as security_definer, p.proconfig, pg_get_functiondef(p.oid) as definition,
  has_function_privilege('anon', p.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'pos_claim_management_request', 'pos_manager_save_catalogue_product',
  'pos_project_product_stock', 'pos_audit_stock_adjustment'
)
order by 1;

select c.table_schema, c.table_name, c.column_name, c.udt_name, c.is_nullable, c.column_default
from information_schema.columns c
where (c.table_schema = 'public' and (
  (c.table_name = 'products' and c.column_name in (
    'id','category','category_id','base_price_usd','stock_quantity','publish_to_pos','is_website_published','active'
  )) or c.table_name in (
    'categories','product_colors','product_images','pos_management_events','stock_movements',
    'pos_stock_adjustments','pos_sale_items','pos_return_items','pos_mpesa_sales','pos_card_payments','pos_quotations'
  )
)) or (c.table_schema = 'storage' and c.table_name = 'objects' and c.column_name in ('bucket_id','name'))
order by 1, 2, c.ordinal_position;

select conrelid::regclass as relation, conname, convalidated, pg_get_constraintdef(oid) as definition
from pg_constraint
where (contype = 'f' and confrelid = to_regclass('public.product_colors'))
   or conrelid in (
     to_regclass('public.products'), to_regclass('public.product_colors'),
     to_regclass('public.product_images'), to_regclass('public.pos_management_events')
   )
order by 1, 2;

select tgrelid::regclass as relation, tgname, tgenabled, pg_get_triggerdef(oid) as definition
from pg_trigger
where not tgisinternal and tgrelid in (to_regclass('public.product_colors'), to_regclass('public.stock_movements'))
order by 1, 2;

select schemaname, tablename, policyname, permissive, roles, cmd, qual
from pg_policies where schemaname = 'public'
  and tablename in ('products','product_colors','product_images','categories')
order by 2, 3;

select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'product-images';

rollback;
