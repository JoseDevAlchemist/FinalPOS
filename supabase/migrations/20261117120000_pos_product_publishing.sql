-- Add publication at creation and a manager adjustment audit linked to the
-- authoritative stock ledger. Apply only after shared-schema review.
begin;

create table public.pos_stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  stock_movement_id uuid not null unique references public.stock_movements(id) on delete restrict,
  reference_uuid uuid not null references public.pos_management_events(client_uuid) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  color_id uuid not null references public.product_colors(id) on delete restrict,
  actor_staff_id uuid not null references public.pos_users(id) on delete restrict,
  delta integer not null check (delta <> 0),
  quantity_before integer not null check (quantity_before >= 0),
  quantity_after integer not null check (quantity_after >= 0),
  reason text not null check (length(trim(reason)) between 1 and 200),
  created_at timestamptz not null default now(),
  check (quantity_after = quantity_before + delta)
);
create index pos_stock_adjustments_product_created
  on public.pos_stock_adjustments(product_id, created_at desc);
alter table public.pos_stock_adjustments enable row level security;
revoke all on public.pos_stock_adjustments from public, anon, authenticated;
grant select on public.pos_stock_adjustments to authenticated;
create policy "Managers read stock adjustments" on public.pos_stock_adjustments
  for select to authenticated using (public.pos_is_manager());

create function public.pos_audit_stock_adjustment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Sale/return movements stay in the general ledger; only manager-created
  -- opening stock and adjustments enter this audit. Both writes commit together.
  if new.reference_uuid is not null and exists (
    select 1 from public.pos_management_events
    where client_uuid = new.reference_uuid
      and actor_staff_id = new.actor_staff_id
      and kind in ('product_created', 'stock_adjusted')
  ) then
    insert into public.pos_stock_adjustments (
      stock_movement_id, reference_uuid, product_id, color_id, actor_staff_id,
      delta, quantity_before, quantity_after, reason, created_at
    ) values (
      new.id, new.reference_uuid, new.product_id, new.color_id, new.actor_staff_id,
      new.delta, new.quantity_after - new.delta, new.quantity_after, new.reason, new.created_at
    );
  end if;
  return new;
end;
$$;
revoke all on function public.pos_audit_stock_adjustment() from public, anon, authenticated;
create trigger pos_stock_adjustment_audit
  after insert on public.stock_movements
  for each row execute function public.pos_audit_stock_adjustment();

create or replace function public.pos_manager_create_product(p_client_uuid uuid, p_product jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_client_uuid; v_color jsonb; v_color_id uuid; v_qty integer; v_price integer;
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
  select actor_staff_id into v_actor from public.pos_management_events where client_uuid=p_client_uuid;
  insert into public.products(id,name,slug,description,category,base_price,barcode,active,is_website_published)
    values(v_id,v_name,trim(both '-' from regexp_replace(lower(v_name),'[^a-z0-9]+','-','g'))||'-'||v_id::text,
      coalesce(p_product->>'description',''),p_product->>'category',v_price,v_barcode,true,coalesce((p_product->>'isWebsitePublished')::boolean,false));
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

-- Preserve colour ids used by historical sales. The original editor deleted
-- and recreated all colours, which fails after the first sale of a product.
create or replace function public.pos_manager_update_product(
  p_product_id uuid,p_name text,p_description text,p_category text,p_base_price integer,
  p_discount_percent integer,p_barcode text,p_active boolean,p_is_website_published boolean,p_colors jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_color jsonb; v_image jsonb; v_id uuid; v_seen uuid[] := '{}'; v_index integer := 0; v_url text;
begin
  select id into v_actor from public.pos_users where auth_user_id=auth.uid() and active and role='manager' for share;
  if not found then raise exception 'not_authorized' using errcode='42501'; end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 200 or p_category is null or p_category not in ('bag','shoe')
    or p_base_price is null or p_base_price not between 0 and 100000000 or p_discount_percent is null or p_discount_percent not between 0 and 100
    or length(coalesce(p_description,''))>5000 or length(coalesce(p_barcode,''))>128 then raise exception 'invalid_product' using errcode='22023'; end if;
  if jsonb_typeof(p_colors) is distinct from 'array' then raise exception 'invalid_colors' using errcode='22023'; end if;
  if jsonb_array_length(p_colors) not between 1 and 30 then raise exception 'invalid_colors' using errcode='22023'; end if;
  if (select count(*)<>count(distinct lower(trim(c->>'name'))) from jsonb_array_elements(p_colors) c) then raise exception 'duplicate_color' using errcode='22023'; end if;
  perform id from public.products where id=p_product_id for update;
  if not found then raise exception 'product_not_found' using errcode='P0002'; end if;
  update public.products set name=trim(p_name),description=coalesce(p_description,''),category=p_category,base_price=p_base_price,
    discount_percent=p_discount_percent,barcode=nullif(trim(p_barcode),''),active=coalesce(p_active,true),is_website_published=coalesce(p_is_website_published,false) where id=p_product_id;
  for v_color in select value from jsonb_array_elements(p_colors) loop
    if length(trim(coalesce(v_color->>'name',''))) not between 1 and 80 or coalesce(v_color->>'hex','') !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'invalid_color' using errcode='22023'; end if;
    if nullif(v_color->>'id','') is not null then
      v_id := (v_color->>'id')::uuid;
      if v_id=any(v_seen) then raise exception 'duplicate_color_id' using errcode='22023'; end if;
      update public.product_colors set color_name=trim(v_color->>'name'),color_hex=v_color->>'hex',sort_order=v_index
        where id=v_id and product_id=p_product_id;
      if not found then raise exception 'color_not_found' using errcode='P0002'; end if;
    else
      insert into public.product_colors(product_id,color_name,color_hex,sort_order,stock_quantity)
        values(p_product_id,trim(v_color->>'name'),v_color->>'hex',v_index,0) returning id into v_id;
    end if;
    v_seen := array_append(v_seen,v_id);
    delete from public.product_images where color_id=v_id;
    if jsonb_typeof(v_color->'images') is distinct from 'array' then raise exception 'invalid_images' using errcode='22023'; end if;
    if jsonb_array_length(v_color->'images')>8 then raise exception 'invalid_images' using errcode='22023'; end if;
    for v_image in select value from jsonb_array_elements(v_color->'images') loop
      v_url := nullif(trim(v_image->>'image_url'),'');
      if v_url is not null and (length(v_url)>2048 or not (v_url ~ '^https?://' or (v_url ~ '^/' and v_url !~ '^//'))) then raise exception 'invalid_image_url' using errcode='22023'; end if;
      insert into public.product_images(color_id,angle,image_url,sort_order) values(v_id,v_image->>'angle',v_url,0);
    end loop;
    v_index := v_index+1;
  end loop;
  if exists(select 1 from public.product_colors where product_id=p_product_id and not(id=any(v_seen)) and stock_quantity>0) then raise exception 'color_has_stock' using errcode='23514'; end if;
  if exists(select 1 from public.pos_sale_items where product_id=p_product_id and not(color_id=any(v_seen))) then raise exception 'color_has_sales' using errcode='23514'; end if;
  if exists(select 1 from public.pos_stock_adjustments where product_id=p_product_id and not(color_id=any(v_seen))) then
    raise exception 'color_has_adjustments' using errcode='23514';
  end if;
  delete from public.product_colors where product_id=p_product_id and not(id=any(v_seen));
  insert into public.pos_management_events(client_uuid,actor_staff_id,kind,payload,result)
    values(gen_random_uuid(),v_actor,'product_updated',jsonb_build_object('product_id',p_product_id),jsonb_build_object('id',p_product_id));
  return p_product_id;
end;
$$;
revoke all on function public.pos_manager_update_product(uuid,text,text,text,integer,integer,text,boolean,boolean,jsonb) from public,anon;
grant execute on function public.pos_manager_update_product(uuid,text,text,text,integer,integer,text,boolean,boolean,jsonb) to authenticated;

commit;
