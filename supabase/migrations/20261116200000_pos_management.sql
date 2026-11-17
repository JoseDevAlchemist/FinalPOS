-- Local Phase 4 management entry points. Review shared-schema compatibility
-- before ever applying this migration to the storefront project.
create table public.pos_management_events (
  client_uuid uuid primary key,
  actor_staff_id uuid not null references public.pos_users(id),
  kind text not null check (kind in ('product_created','stock_adjusted','cashier_created','product_updated')),
  payload jsonb not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.pos_management_events enable row level security;
revoke all on public.pos_management_events from public, anon, authenticated;
grant select on public.pos_management_events to authenticated;
create policy "Managers read management events" on public.pos_management_events
  for select to authenticated using (public.pos_is_manager());

create function public.pos_claim_management_request(p_uuid uuid, p_kind text, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_inserted uuid; v_old public.pos_management_events%rowtype;
begin
  select id into v_actor from public.pos_users where auth_user_id=auth.uid() and active and role='manager' for share;
  if not found then raise exception 'not_authorized' using errcode='42501'; end if;
  if p_uuid is null then raise exception 'request_uuid_required' using errcode='22023'; end if;
  insert into public.pos_management_events(client_uuid,actor_staff_id,kind,payload)
    values(p_uuid,v_actor,p_kind,p_payload) on conflict(client_uuid) do nothing returning client_uuid into v_inserted;
  if v_inserted is not null then return true; end if;
  select * into v_old from public.pos_management_events where client_uuid=p_uuid;
  if v_old.actor_staff_id <> v_actor or v_old.kind <> p_kind or v_old.payload is distinct from p_payload then
    raise exception 'idempotency_mismatch' using errcode='22023';
  end if;
  return false;
end;
$$;
revoke all on function public.pos_claim_management_request(uuid,text,jsonb) from public,anon,authenticated;

create function public.pos_manager_create_product(p_client_uuid uuid, p_product jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_client_uuid; v_color jsonb; v_color_id uuid; v_qty integer; v_price integer;
  v_actor uuid; v_name text; v_barcode text; v_url text; v_index integer := 0;
begin
  if not public.pos_claim_management_request(p_client_uuid,'product_created',p_product) then
    return (select (result->>'id')::uuid from public.pos_management_events where client_uuid=p_client_uuid);
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
      coalesce(p_product->>'description',''),p_product->>'category',v_price,v_barcode,true,false);
  for v_color in select value from jsonb_array_elements(p_product->'colors') loop
    if length(trim(coalesce(v_color->>'name',''))) not between 1 and 80
      or coalesce(v_color->>'hex','') !~ '^#[0-9A-Fa-f]{6}$'
      or coalesce(v_color->>'stockQuantity','') !~ '^[0-9]+$' then raise exception 'invalid_color' using errcode='22023'; end if;
    v_qty := (v_color->>'stockQuantity')::integer;
    if v_qty > 100000 then raise exception 'invalid_stock' using errcode='22023'; end if;
    insert into public.product_colors(product_id,color_name,color_hex,sort_order,stock_quantity)
      values(v_id,trim(v_color->>'name'),v_color->>'hex',v_index,v_qty) returning id into v_color_id;
    if v_qty>0 then
      insert into public.stock_movements(product_id,color_id,delta,quantity_after,reason,actor_staff_id)
        values(v_id,v_color_id,v_qty,v_qty,'initial_stock:'||p_client_uuid::text,v_actor);
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

alter table public.stock_movements add column reference_uuid uuid;

create function public.pos_manager_adjust_stock(p_client_uuid uuid,p_product_id uuid,p_color_id uuid,p_delta integer,p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_after integer; v_actor uuid;
begin
  if length(trim(coalesce(p_reason,''))) not between 1 and 200 or p_delta is null or p_delta=0 or p_delta not between -100000 and 100000 then
    raise exception 'invalid_adjustment' using errcode='22023';
  end if;
  if not public.pos_claim_management_request(p_client_uuid,'stock_adjusted',jsonb_build_object('product_id',p_product_id,'color_id',p_color_id,'delta',p_delta,'reason',trim(p_reason))) then
    return (select (result->>'stockQuantity')::integer from public.pos_management_events where client_uuid=p_client_uuid);
  end if;
  perform id from public.products where id=p_product_id for update;
  update public.product_colors set stock_quantity=stock_quantity+p_delta
    where id=p_color_id and product_id=p_product_id and stock_quantity+p_delta>=0 returning stock_quantity into v_after;
  if not found then raise exception 'invalid_color_or_insufficient_stock' using errcode='23514'; end if;
  select actor_staff_id into v_actor from public.pos_management_events where client_uuid=p_client_uuid;
  insert into public.stock_movements(product_id,color_id,delta,quantity_after,reason,actor_staff_id,reference_uuid)
    values(p_product_id,p_color_id,p_delta,v_after,trim(p_reason),v_actor,p_client_uuid);
  update public.pos_management_events set result=jsonb_build_object('stockQuantity',v_after) where client_uuid=p_client_uuid;
  return v_after;
end;
$$;
revoke all on function public.pos_manager_adjust_stock(uuid,uuid,uuid,integer,text) from public,anon;
grant execute on function public.pos_manager_adjust_stock(uuid,uuid,uuid,integer,text) to authenticated;

create function public.pos_manager_create_cashier(p_client_uuid uuid,p_auth_user_id uuid,p_name text,p_pin text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_existing public.pos_users%rowtype;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' or length(trim(coalesce(p_name,''))) not between 2 and 100
    or p_auth_user_id is distinct from p_client_uuid then raise exception 'invalid_cashier' using errcode='22023'; end if;
  -- Never store a PIN or hash in the manager-readable audit payload.
  if not public.pos_claim_management_request(p_client_uuid,'cashier_created',jsonb_build_object('auth_user_id',p_auth_user_id,'name',trim(p_name))) then
    select * into v_existing from public.pos_users where id=p_client_uuid;
    if v_existing.pin_hash is null or extensions.crypt(p_pin,v_existing.pin_hash) is distinct from v_existing.pin_hash then
      raise exception 'idempotency_mismatch' using errcode='22023';
    end if;
    return v_existing.id;
  end if;
  -- PIN login identifies a staff row by PIN, so concurrent enrollment must
  -- serialize the uniqueness check without shipping verifiers to the browser.
  perform pg_advisory_xact_lock(714004);
  if exists(select 1 from public.pos_users where active and extensions.crypt(p_pin,pin_hash)=pin_hash) then
    raise exception 'pin_in_use' using errcode='23505';
  end if;
  if not exists(select 1 from auth.users where id=p_auth_user_id and email='pos-'||p_client_uuid::text||'@pedigree.local'
    and raw_app_meta_data->>'pos_managed'='true') then raise exception 'staff_auth_not_ready' using errcode='22023'; end if;
  insert into public.pos_users(id,auth_user_id,name,pin_hash,role,active)
    values(p_client_uuid,p_auth_user_id,trim(p_name),extensions.crypt(p_pin,extensions.gen_salt('bf',10)),'cashier',true);
  update public.pos_management_events set result=jsonb_build_object('id',p_client_uuid) where client_uuid=p_client_uuid;
  return p_client_uuid;
end;
$$;
revoke all on function public.pos_manager_create_cashier(uuid,uuid,text,text) from public,anon;
grant execute on function public.pos_manager_create_cashier(uuid,uuid,text,text) to authenticated;

create function public.pos_manager_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_start timestamptz := date_trunc('day',now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi';
begin
  if not public.pos_is_manager() then raise exception 'not_authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'todayTotal',(select coalesce(sum(total),0) from public.pos_sales where created_at>=v_start and payment_status='paid'),
    'todayCount',(select count(*) from public.pos_sales where created_at>=v_start and payment_status='paid'),
    'lowStockCount',(select count(*) from public.product_colors c join public.products p on p.id=c.product_id where p.active and c.stock_quantity<=2),
    'lowStock',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (
      select c.id,p.name,c.color_name,c.stock_quantity from public.product_colors c join public.products p on p.id=c.product_id
      where p.active and c.stock_quantity<=2 order by c.stock_quantity,c.id limit 12) t),
    'recentSales',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (
      select id,staff_name,total,payment_method,payment_status,created_at from public.pos_sales where created_at>=v_start order by created_at desc,id limit 10) t),
    'exchangeRate',coalesce((select to_jsonb(s)->'value'->'kes_per_usd'
      from public.shop_settings s where to_jsonb(s)->>'key'='exchange_rate' limit 1),'130'::jsonb)
  );
end;
$$;
revoke all on function public.pos_manager_dashboard() from public,anon;
grant execute on function public.pos_manager_dashboard() to authenticated;
