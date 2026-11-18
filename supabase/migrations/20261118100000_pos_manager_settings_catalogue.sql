-- Storefront grants on the table may cover newly added columns. Protect
-- the rate without changing access to the storefront's other settings.
create function public.pos_guard_storefront_exchange_rate()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'use_exchange_rate_rpc' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.pos_guard_storefront_exchange_rate() from public, anon, authenticated;

-- The storefront settings migration owns the default row. Add only the POS rate.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shop_settings'
      and column_name = 'id' and udt_name = 'text'
  ) then
    alter table public.shop_settings
      add column if not exists exchange_rate_kes_to_usd numeric not null default 130;
    create trigger pos_guard_storefront_exchange_rate
      before update of exchange_rate_kes_to_usd on public.shop_settings
      for each row when (old.exchange_rate_kes_to_usd is distinct from new.exchange_rate_kes_to_usd)
      execute function public.pos_guard_storefront_exchange_rate();
  end if;
end;
$$;

alter table public.pos_management_events
  drop constraint pos_management_events_kind_check,
  add constraint pos_management_events_kind_check check (
    kind in ('product_created','stock_adjusted','cashier_created','product_updated','exchange_rate_updated')
  );

create function public.pos_manager_update_exchange_rate(p_rate numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_rate is null or not (p_rate > 0 and p_rate <= 100000) then
    raise exception 'invalid_exchange_rate' using errcode = '22023';
  end if;

  perform public.pos_claim_management_request(gen_random_uuid(), 'exchange_rate_updated',
    jsonb_build_object('kes_per_usd', p_rate));

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shop_settings'
      and column_name = 'id' and udt_name = 'text'
  ) then
    update public.shop_settings set exchange_rate_kes_to_usd = p_rate, updated_at = now()
      where id = 'default';
  else
    update public.shop_settings set exchange_rate_kes_to_usd = p_rate
      where key = 'exchange_rate';
  end if;

  if not found then
    raise exception 'exchange_rate_settings_missing' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.pos_manager_update_exchange_rate(numeric) from public, anon;
grant execute on function public.pos_manager_update_exchange_rate(numeric) to authenticated;

create or replace function public.pos_manager_create_product(p_client_uuid uuid, p_product jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_client_uuid; v_color jsonb; v_color_id uuid; v_qty integer; v_price integer;
  v_category_id uuid; v_category text;
  v_actor uuid; v_name text; v_barcode text; v_url text; v_index integer := 0;
begin
  if not public.pos_claim_management_request(p_client_uuid,'product_created',p_product) then
    return (select (result->>'id')::uuid from public.pos_management_events where client_uuid=p_client_uuid);
  end if;
  if p_product ? 'isWebsitePublished'
    and jsonb_typeof(p_product->'isWebsitePublished') is distinct from 'boolean' then
    raise exception 'invalid_publication_flag' using errcode='22023';
  end if;
  v_name := trim(p_product->>'name');
  v_price := (p_product->>'basePrice')::integer;
  v_barcode := nullif(trim(p_product->>'barcode'),'');
  if v_name is null or length(v_name) not between 2 and 200 or v_price is null or v_price not between 0 and 100000000
     or (p_product->>'category') is null or (p_product->>'category') not in ('bag','shoe')
     or length(coalesce(p_product->>'description','')) > 5000 or length(v_barcode)>128 then
    raise exception 'invalid_product' using errcode='22023';
  end if;
  if jsonb_typeof(p_product->'colors') is distinct from 'array' then raise exception 'invalid_colors' using errcode='22023'; end if;
  if jsonb_array_length(p_product->'colors') not between 1 and 30 then raise exception 'invalid_colors' using errcode='22023'; end if;
  if (select count(*) <> count(distinct lower(trim(c->>'name'))) from jsonb_array_elements(p_product->'colors') c) then
    raise exception 'duplicate_color' using errcode='22023';
  end if;
  v_category := p_product->>'category';
  v_category_id := (p_product->>'categoryId')::uuid;
  if v_category_id is not null then
    if to_regclass('public.categories') is null or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'products' and column_name = 'category_id'
    ) then
      raise exception 'category_not_found' using errcode = 'P0002';
    end if;

    perform 1 from public.categories where id = v_category_id and is_active for share;
    if not found then
      raise exception 'category_not_found' using errcode = 'P0002';
    end if;

    -- Older POS and storefront routes still use the bag/shoe discriminator.
    with recursive ancestors as (
      select id, slug, parent_id from public.categories where id = v_category_id
      union
      select c.id, c.slug, c.parent_id
      from public.categories c join ancestors a on c.id = a.parent_id
    )
    select case when exists (select 1 from ancestors where slug = 'shoes')
      then 'shoe' else 'bag' end into v_category;
  end if;

  select actor_staff_id into v_actor from public.pos_management_events where client_uuid=p_client_uuid;
  insert into public.products(id,name,slug,description,category,base_price,barcode,active,is_website_published)
    values(v_id,v_name,trim(both '-' from regexp_replace(lower(v_name),'[^a-z0-9]+','-','g'))||'-'||v_id::text,
      coalesce(p_product->>'description',''),v_category,v_price,v_barcode,true,coalesce((p_product->>'isWebsitePublished')::boolean,false));
  if v_category_id is not null then
    update public.products set category_id = v_category_id where id = v_id;
  end if;
  for v_color in select value from jsonb_array_elements(p_product->'colors') loop
    if length(trim(coalesce(v_color->>'name',''))) not between 1 and 80
      or coalesce(v_color->>'hex','') !~ '^#[0-9A-Fa-f]{6}$'
      or coalesce(v_color->>'stockQuantity','') !~ '^[0-9]+$' then raise exception 'invalid_color' using errcode='22023'; end if;
    v_qty := (v_color->>'stockQuantity')::integer;
    if v_qty > 100000 then raise exception 'invalid_stock' using errcode='22023'; end if;
    insert into public.product_colors(product_id,color_name,color_hex,sort_order,stock_quantity)
      values(v_id,trim(v_color->>'name'),v_color->>'hex',v_index,v_qty) returning id into v_color_id;
    if v_qty>0 then
      insert into public.stock_movements(product_id,color_id,delta,quantity_after,reason,actor_staff_id,reference_uuid)
        values(v_id,v_color_id,v_qty,v_qty,'initial_stock:'||p_client_uuid::text,v_actor,p_client_uuid);
    end if;
    v_url := nullif(trim(v_color->>'imageUrl'),'');
    if v_url is not null then
      if length(v_url)>2048 or not (v_url ~ '^https?://' or (v_url ~ '^/' and v_url !~ '^//')) then raise exception 'invalid_image_url' using errcode='22023'; end if;
      insert into public.product_images(color_id,angle,image_url,sort_order) values(v_color_id,'front',v_url,0);
    end if;
    v_index := v_index+1;
  end loop;
  update public.pos_management_events set result=jsonb_build_object('id',v_id) where client_uuid=p_client_uuid;
  return v_id;
end;
$$;
revoke all on function public.pos_manager_create_product(uuid,jsonb) from public,anon;
grant execute on function public.pos_manager_create_product(uuid,jsonb) to authenticated;
