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
  delete from public.product_colors where product_id=p_product_id and not(id=any(v_seen));
  insert into public.pos_management_events(client_uuid,actor_staff_id,kind,payload,result)
    values(gen_random_uuid(),v_actor,'product_updated',jsonb_build_object('product_id',p_product_id),jsonb_build_object('id',p_product_id));
  return p_product_id;
end;
$$;
revoke all on function public.pos_manager_update_product(uuid,text,text,text,integer,integer,text,boolean,boolean,jsonb) from public,anon;
grant execute on function public.pos_manager_update_product(uuid,text,text,text,integer,integer,text,boolean,boolean,jsonb) to authenticated;
