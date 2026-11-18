-- Review with the storefront team before applying. Adds one RPC and leaves
-- existing RPC signatures, shared tables, policies and triggers in place.
begin;

-- Check the installed capabilities instead of assuming a migration history.
do $$
begin
  if not exists (select 1 from pg_proc
       where oid = to_regprocedure('public.pos_claim_management_request(uuid,text,jsonb)') and prosecdef)
     or has_function_privilege('anon', to_regprocedure('public.pos_claim_management_request(uuid,text,jsonb)'), 'execute')
     or has_function_privilege('authenticated', to_regprocedure('public.pos_claim_management_request(uuid,text,jsonb)'), 'execute') then
    raise exception 'catalogue_requires_private_request_helper';
  end if;

  perform actor_staff_id, client_uuid, kind, payload, result from public.pos_management_events limit 0;
  perform id, auth_user_id, active, role from public.pos_users limit 0;
  perform id, stock_quantity, is_website_published from public.products limit 0;
  perform id, product_id, stock_quantity from public.product_colors limit 0;
  perform color_id, angle, sort_order, image_url from public.product_images limit 0;
  perform color_id from public.pos_sale_items limit 0;
  perform color_id from public.pos_return_items limit 0;
  perform color_id from public.pos_stock_adjustments limit 0;
  perform color_id, actor_staff_id, reference_uuid from public.stock_movements limit 0;
  perform items from public.pos_mpesa_sales limit 0;
  perform items from public.pos_card_payments limit 0;
  perform request_items from public.pos_quotations limit 0;
  perform name, bucket_id from storage.objects limit 0;
  if not exists (select 1 from storage.buckets where id = 'product-images' and public) then
    raise exception 'catalogue_requires_public_product_images_bucket';
  end if;

  if not exists (
    select 1 from pg_index
    where indrelid = 'public.product_images'::regclass and indisunique and indisvalid and indimmediate
      and indpred is null and indexprs is null and indnkeyatts = 2
      and indkey[0] in (
        select attnum from pg_attribute where attrelid = indrelid and attname in ('color_id', 'angle')
      )
      and indkey[1] in (
        select attnum from pg_attribute where attrelid = indrelid and attname in ('color_id', 'angle')
      )
      and indkey[0] <> indkey[1]
  ) then
    raise exception 'catalogue_requires_unique_color_angle';
  end if;

  if not exists (
    select 1 from pg_trigger where tgrelid = 'public.product_colors'::regclass
      and tgfoid = to_regprocedure('public.pos_project_product_stock()') and tgenabled in ('O', 'A')
  ) or not exists (
    select 1 from pg_trigger where tgrelid = 'public.stock_movements'::regclass
      and tgfoid = to_regprocedure('public.pos_audit_stock_adjustment()') and tgenabled in ('O', 'A')
  ) then
    raise exception 'catalogue_requires_stock_triggers';
  end if;
end;
$$;

create function public.pos_manager_save_catalogue_product(p_client_uuid uuid, p_product jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
-- Fail closed if the installer chose an owner whose reads would omit history.
set row_security = off
-- Source: the shared storefront's public Storage origin in next.config.ts.
-- Isolated environments set their own origin with ALTER FUNCTION, as owner.
set pos.catalogue_storage_origin = 'https://scvscxbxfpjqbqkfkset.supabase.co'
as $$
declare
  v_edit boolean := p_product ? 'productId';
  v_kind text := case when v_edit then 'product_updated' else 'product_created' end;
  v_product_id uuid;
  v_name text;
  v_category text;
  v_category_id uuid;
  v_has_taxonomy boolean;
  v_was_published boolean := false;
  v_category_node uuid;
  v_category_parent uuid;
  v_category_label text;
  v_category_active boolean;
  v_categories_seen uuid[] := '{}';
  v_price integer;
  v_usd integer;
  v_discount integer;
  v_code text;
  v_published boolean;
  v_actor uuid;
  v_claimed boolean;
  v_saved_id uuid;
  v_image_prefix text := current_setting('pos.catalogue_storage_origin') || '/storage/v1/object/public/product-images/';
  v_image_key text;
  v_legacy_urls text[];
  v_removed_ids uuid[];
  v_fk record;
  v_referenced boolean;
  v_color jsonb;
  v_color_id uuid;
  v_color_order integer;
  v_colors_kept uuid[] := '{}';
  v_stock integer;
  v_image jsonb;
  v_image_order integer;
  v_angle text;
  v_angles_kept text[];
  v_url text;
begin
  -- Check the signed-in manager independently of the installed request helper.
  select id into v_actor from public.pos_users
    where auth_user_id = auth.uid() and active and role = 'manager' for share;
  if not found then raise exception 'not_authorized' using errcode = '42501'; end if;

  v_claimed := public.pos_claim_management_request(p_client_uuid, v_kind, p_product);
  select (result->>'id')::uuid into v_saved_id
    from public.pos_management_events
    where client_uuid = p_client_uuid and actor_staff_id = v_actor
      and kind = v_kind and payload = p_product;
  if not found or v_claimed is null or (not v_claimed and v_saved_id is null) then
    raise exception 'catalogue_request_claim_invalid';
  end if;
  if not v_claimed then return v_saved_id; end if;

  v_product_id := case when v_edit then (p_product->>'productId')::uuid else p_client_uuid end;
  v_name := trim(p_product->>'name');
  v_category := p_product->>'category';
  v_category_id := (p_product->>'categoryId')::uuid;
  v_price := (p_product->>'basePrice')::integer;
  v_usd := (p_product->>'basePriceUsd')::integer;
  v_discount := (p_product->>'discountPercent')::integer;
  v_code := nullif(trim(p_product->>'barcode'), '');

  if v_product_id is null or v_name is null or length(v_name) not between 2 and 200
     or v_category is null or v_category not in ('bag', 'shoe')
     or length(coalesce(p_product->>'description', '')) > 5000 or length(v_code) > 128
     or v_price is null or v_price not between 0 and 100000000
     or v_discount is null or v_discount not between 0 and 100
     or v_usd not between 1 and 1000000
     or (v_edit and p_product ? 'active' and jsonb_typeof(p_product->'active') is distinct from 'boolean')
     or jsonb_typeof(p_product->'isWebsitePublished') is distinct from 'boolean' then
    raise exception 'invalid_product' using errcode = '22023';
  end if;

  v_published := (p_product->>'isWebsitePublished')::boolean;

  if jsonb_typeof(p_product->'colors') is distinct from 'array' then
    raise exception 'invalid_colors' using errcode = '22023';
  end if;
  if jsonb_array_length(p_product->'colors') not between 1 and 30 then
    raise exception 'invalid_colors' using errcode = '22023';
  end if;
  if (select count(*) <> count(distinct lower(trim(c->>'name')))
      from jsonb_array_elements(p_product->'colors') c) then
    raise exception 'duplicate_color' using errcode = '22023';
  end if;

  v_has_taxonomy := to_regclass('public.categories') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'category_id'
  );

  if v_edit then
    select is_website_published into v_was_published from public.products where id = v_product_id for update;
    if not found then raise exception 'product_not_found' using errcode = 'P0002'; end if;
    if v_has_taxonomy and v_category_id is null then
      if v_published then
        select category_id into v_category_id from public.products where id = v_product_id;
      else
        select category into v_category from public.products where id = v_product_id;
      end if;
    end if;
  end if;

  if v_category_id is not null then
    if not v_has_taxonomy then raise exception 'category_not_found' using errcode = 'P0002'; end if;
    v_category_node := v_category_id;
    -- Lock the selected branch so it stays active and under the same root through commit.
    loop
      if v_category_node = any(v_categories_seen) then
        raise exception 'category_not_found' using errcode = 'P0002';
      end if;
      v_categories_seen := array_append(v_categories_seen, v_category_node);
      select parent_id, lower(slug || ' ' || name), is_active into v_category_parent, v_category_label, v_category_active
        from public.categories where id = v_category_node for share;
      if not found or not v_category_active then
        raise exception 'category_not_found' using errcode = 'P0002';
      end if;
      exit when v_category_parent is null;
      v_category_node := v_category_parent;
    end loop;
    v_category := case when v_category_label ~ 'shoe|sneaker|boot|sandal|loafer|heel' then 'shoe' else 'bag' end;
  elsif v_published and (v_has_taxonomy or not v_was_published) then
    raise exception 'category_required' using errcode = '22023';
  end if;

  -- Apply the storefront editor's limits on first publication. Existing
  -- published records can keep legacy details when editing their photos.
  if v_published and not v_was_published and (
    length(v_name) > 80 or length(trim(coalesce(p_product->>'description', ''))) not between 1 and 600
    or v_price > 10000000 or v_discount > 99 or jsonb_array_length(p_product->'colors') > 8
    or exists (select 1 from jsonb_array_elements(p_product->'colors') c where length(trim(c->>'name')) > 40)
  ) then
    raise exception 'storefront_product_limits' using errcode = '22023';
  end if;

  if v_edit then
    update public.products
      set name = v_name, description = coalesce(p_product->>'description', ''),
          category = v_category, base_price = v_price, discount_percent = v_discount,
          barcode = v_code, active = coalesce((p_product->>'active')::boolean, active),
          is_website_published = v_published
      where id = v_product_id;
  else
    insert into public.products (
      id, name, slug, description, category, base_price, discount_percent, barcode,
      active, is_website_published
    ) values (
      v_product_id, v_name,
      trim(both '-' from left(coalesce(nullif(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), ''), 'product'), 42))
        || '-' || v_product_id::text,
      coalesce(p_product->>'description', ''), v_category, v_price, v_discount,
      v_code, true, v_published
    );
    -- The POS-only baseline predates this storefront column.
    if exists (
      select 1 from pg_attribute where attrelid = 'public.products'::regclass
        and attname = 'publish_to_pos' and not attisdropped
    ) then
      update public.products set publish_to_pos = true where id = v_product_id;
    end if;
  end if;

  if v_category_id is not null then
    update public.products set category_id = v_category_id where id = v_product_id;
  end if;
  if p_product ? 'basePriceUsd' then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'products' and column_name = 'base_price_usd'
    ) then
      raise exception 'usd_override_unavailable' using errcode = '22023';
    end if;
    update public.products set base_price_usd = v_usd where id = v_product_id;
  end if;

  for v_color, v_color_order in
    select value, (ordinality - 1)::integer
    from jsonb_array_elements(p_product->'colors') with ordinality
  loop
    if length(trim(coalesce(v_color->>'name', ''))) not between 1 and 80
       or coalesce(v_color->>'hex', '') !~ '^#[0-9A-Fa-f]{6}$' then
      raise exception 'invalid_color' using errcode = '22023';
    end if;

    v_color_id := (v_color->>'id')::uuid;
    if v_edit and v_color_id is not null then
      if v_color_id = any(v_colors_kept) then
        raise exception 'duplicate_color_id' using errcode = '22023';
      end if;
      update public.product_colors
        set color_name = trim(v_color->>'name'), color_hex = v_color->>'hex', sort_order = v_color_order
        where id = v_color_id and product_id = v_product_id;
      if not found then raise exception 'color_not_found' using errcode = 'P0002'; end if;
    else
      v_stock := case when v_edit then 0 else (v_color->>'stockQuantity')::integer end;
      if v_stock is null or v_stock not between 0 and 100000 then
        raise exception 'invalid_stock' using errcode = '22023';
      end if;
      insert into public.product_colors (product_id, color_name, color_hex, sort_order, stock_quantity)
        values (v_product_id, trim(v_color->>'name'), v_color->>'hex', v_color_order, v_stock)
        returning id into v_color_id;
      if v_stock > 0 then
        insert into public.stock_movements (
          product_id, color_id, delta, quantity_after, reason, actor_staff_id, reference_uuid
        ) values (
          v_product_id, v_color_id, v_stock, v_stock, 'initial_stock:' || p_client_uuid::text,
          v_actor, p_client_uuid
        );
      end if;
    end if;
    v_colors_kept := array_append(v_colors_kept, v_color_id);

    if jsonb_typeof(v_color->'images') is distinct from 'array' then
      raise exception 'invalid_images' using errcode = '22023';
    end if;
    if jsonb_array_length(v_color->'images') > 8 then
      raise exception 'invalid_images' using errcode = '22023';
    end if;
    -- Snapshot this variant's saved URLs before edits so legacy angle swaps remain valid.
    select array_agg(image_url) into v_legacy_urls
      from public.product_images where color_id = v_color_id and image_url is not null;
    v_angles_kept := '{}';
    for v_image, v_image_order in
      select value, (ordinality - 1)::integer
      from jsonb_array_elements(v_color->'images') with ordinality
    loop
      v_angle := v_image->>'angle';
      v_url := nullif(trim(v_image->>'imageUrl'), '');
      if v_angle is null or v_angle not in ('front', 'side-left', 'side-right', 'side', 'top', 'bottom', 'back', 'laces')
         or v_angle = any(v_angles_kept) then
        raise exception 'invalid_image_angle' using errcode = '22023';
      end if;
      if v_url is null or length(v_url) > 2048 then
        raise exception 'invalid_image_url' using errcode = '22023';
      end if;
      if not (coalesce(v_url = any(v_legacy_urls), false)
              and (v_url ~ '^https?://[^/[:space:]]' or v_url ~ '^/[^/\\]')) then
        v_image_key := substr(v_url, length(v_image_prefix) + 1);
        if not starts_with(v_url, v_image_prefix)
           or not starts_with(v_image_key, v_product_id::text || '/')
           or v_image_key !~ '^[a-f0-9-]{36}/[a-zA-Z0-9_-]+[.](jpg|jpeg|png|webp|avif)$' then
          raise exception 'invalid_image_url' using errcode = '22023';
        end if;
        perform 1 from storage.objects where bucket_id = 'product-images' and name = v_image_key for key share;
        if not found then raise exception 'invalid_image_url' using errcode = '22023'; end if;
      end if;
      v_angles_kept := array_append(v_angles_kept, v_angle);
      insert into public.product_images (color_id, angle, image_url, sort_order)
        values (v_color_id, v_angle, v_url, v_image_order)
        on conflict (color_id, angle) do update
          set image_url = excluded.image_url, sort_order = excluded.sort_order;
    end loop;
    delete from public.product_images
      where color_id = v_color_id and image_url is not null and not (angle = any(v_angles_kept));
  end loop;

  if v_edit then
    -- Lock candidates before inspecting history. FK inserts must take a key
    -- share lock and therefore cannot race a successful removal.
    select array(select id from public.product_colors
      where product_id = v_product_id and not (id = any(v_colors_kept))
      order by id for update) into v_removed_ids;
    if cardinality(v_removed_ids) > 0 then
      if exists (select 1 from public.product_colors where id = any(v_removed_ids) and stock_quantity <> 0) then
        raise exception 'color_has_stock' using errcode = '23514';
      end if;
      if exists (select 1 from public.pos_sale_items where color_id = any(v_removed_ids))
         or exists (select 1 from public.pos_return_items where color_id = any(v_removed_ids))
         or exists (select 1 from public.stock_movements where color_id = any(v_removed_ids))
         or exists (select 1 from public.pos_stock_adjustments where color_id = any(v_removed_ids)) then
        raise exception 'color_has_history' using errcode = '23514';
      end if;
      -- These snapshots refer to colour IDs in JSON rather than through FKs.
      if exists (
        select 1 from unnest(v_removed_ids) removed(id)
        cross join lateral (select jsonb_build_array(jsonb_build_object('color_id', removed.id)) as item) snapshot
        where exists (select 1 from public.pos_mpesa_sales where items @> snapshot.item)
           or exists (select 1 from public.pos_card_payments where items @> snapshot.item)
           or exists (select 1 from public.pos_quotations where request_items @> snapshot.item)
      ) then
        raise exception 'color_has_history' using errcode = '23514';
      end if;
      -- Refuse to invoke SET NULL or CASCADE on additional FKs, including
      -- a deployed FK on an alternate or composite key.
      for v_fk in
        select n.nspname, r.relname,
          string_agg(format('history.%I = colour.%I', a.attname, target.attname), ' and ') as match
        from pg_constraint f
        join pg_class r on r.oid = f.conrelid
        join pg_namespace n on n.oid = r.relnamespace
        cross join lateral unnest(f.conkey, f.confkey) cols(source_attnum, target_attnum)
        join pg_attribute a on a.attrelid = f.conrelid and a.attnum = cols.source_attnum
        join pg_attribute target on target.attrelid = f.confrelid and target.attnum = cols.target_attnum
        where f.contype = 'f' and f.confrelid = 'public.product_colors'::regclass
          and not (f.conrelid = 'public.product_images'::regclass
            and cardinality(f.conkey) = 1 and a.attname = 'color_id' and target.attname = 'id')
        group by f.oid, n.nspname, r.relname
      loop
        execute format(
          'select exists (select 1 from %I.%I history join public.product_colors colour on %s where colour.id = any($1))',
          v_fk.nspname, v_fk.relname, v_fk.match)
          into v_referenced using v_removed_ids;
        if v_referenced then
          raise exception 'color_has_history' using errcode = '23514';
        end if;
      end loop;
      delete from public.product_colors where id = any(v_removed_ids);
    end if;
  end if;

  if (select stock_quantity from public.products where id = v_product_id) is distinct from
     (select coalesce(sum(stock_quantity), 0) from public.product_colors where product_id = v_product_id) then
    raise exception 'catalogue_stock_projection_mismatch' using errcode = '23514';
  end if;

  update public.pos_management_events set result = jsonb_build_object('id', v_product_id)
    where client_uuid = p_client_uuid;
  return v_product_id;
end;
$$;

revoke all on function public.pos_manager_save_catalogue_product(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.pos_manager_save_catalogue_product(uuid, jsonb) to authenticated;

commit;
