begin;
create table public.pos_quotations (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid not null unique,
  share_token uuid not null default gen_random_uuid(),
  created_by uuid not null references public.pos_users(id) on delete restrict,
  staff_name text not null,
  customer_name text not null check (length(trim(customer_name)) between 1 and 200),
  customer_phone text not null check (customer_phone ~ '^[1-9][0-9]{7,14}$'),
  subtotal integer not null check (subtotal >= 0),
  discount_amount integer not null default 0 check (discount_amount >= 0),
  total integer not null check (total >= 0),
  items jsonb not null,
  request_items jsonb not null,
  created_at timestamptz not null default now()
);
create table public.pos_receipt_documents (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid not null unique,
  share_token uuid not null default gen_random_uuid(),
  sale_id uuid not null references public.pos_sales(id) on delete restrict,
  sale_created_at timestamptz not null,
  created_by uuid not null references public.pos_users(id) on delete restrict,
  staff_name text not null,
  customer_name text not null check (length(trim(customer_name)) between 1 and 200),
  customer_phone text not null check (customer_phone ~ '^[1-9][0-9]{7,14}$'),
  subtotal integer not null check (subtotal >= 0),
  discount_amount integer not null check (discount_amount >= 0),
  total integer not null check (total >= 0),
  items jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.pos_quotations enable row level security;
alter table public.pos_receipt_documents enable row level security;
revoke all on public.pos_quotations, public.pos_receipt_documents from public,anon,authenticated;
grant select on public.pos_quotations, public.pos_receipt_documents to authenticated;
create policy "Staff read their quotations" on public.pos_quotations for select to authenticated
  using (public.pos_is_manager() or exists(select 1 from public.pos_users where auth_user_id=auth.uid() and active and id=created_by));
create policy "Staff read their receipt documents" on public.pos_receipt_documents for select to authenticated
  using (public.pos_is_manager() or exists(select 1 from public.pos_users where auth_user_id=auth.uid() and active and id=created_by));

create function public.pos_create_quotation(p_client_uuid uuid,p_customer_name text,p_customer_phone text,p_items jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_staff public.pos_users%rowtype; v_existing public.pos_quotations%rowtype;
  v_payload jsonb; v_item record; v_product public.products%rowtype; v_color public.product_colors%rowtype;
  v_unit integer; v_total bigint:=0; v_lines jsonb:='[]'::jsonb; v_id uuid; v_image text;
begin
  select * into v_staff from public.pos_users where auth_user_id=auth.uid() and active for share;
  if not found then raise exception 'not_authorized' using errcode='42501'; end if;
  if p_client_uuid is null or length(trim(coalesce(p_customer_name,''))) not between 1 and 200
    or coalesce(p_customer_phone,'') !~ '^[1-9][0-9]{7,14}$' then raise exception 'invalid_customer' using errcode='22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'invalid_items' using errcode='22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'invalid_items' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) i where jsonb_typeof(i->'quantity') is distinct from 'number'
    or coalesce(i->>'quantity','') !~ '^[0-9]+$') then raise exception 'invalid_quantity' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('product_id',i.product_id,'color_id',i.color_id,'quantity',i.quantity) order by i.product_id,i.color_id)
    into v_payload from jsonb_to_recordset(p_items) as i(product_id uuid,color_id uuid,quantity integer);
  if exists(select 1 from jsonb_to_recordset(v_payload) as i(product_id uuid,color_id uuid,quantity integer)
    where i.product_id is null or i.color_id is null or i.quantity not between 1 and 1000)
    or (select count(*)<>count(distinct (i.product_id,i.color_id)) from jsonb_to_recordset(v_payload) as i(product_id uuid,color_id uuid,quantity integer)) then
    raise exception 'invalid_items' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_uuid::text,1));
  select * into v_existing from public.pos_quotations where client_uuid=p_client_uuid;
  if found then
    if v_existing.created_by<>v_staff.id or v_existing.customer_name<>trim(p_customer_name)
      or v_existing.customer_phone<>p_customer_phone or v_existing.request_items is distinct from v_payload then
      raise exception 'idempotency_mismatch' using errcode='22023'; end if;
    return v_existing.id;
  end if;
  perform p.id from public.products p where p.id in(select i.product_id from jsonb_to_recordset(v_payload) as i(product_id uuid)) order by p.id for share;
  perform c.id from public.product_colors c where c.id in(select i.color_id from jsonb_to_recordset(v_payload) as i(color_id uuid)) order by c.id for share;
  for v_item in select * from jsonb_to_recordset(v_payload) as i(product_id uuid,color_id uuid,quantity integer) loop
    select * into v_product from public.products where id=v_item.product_id and active;
    if not found then raise exception 'product_unavailable' using errcode='P0002'; end if;
    select * into v_color from public.product_colors where id=v_item.color_id and product_id=v_product.id;
    if not found then raise exception 'color_not_found' using errcode='P0002'; end if;
    v_unit:=round(v_product.base_price::numeric*(100-v_product.discount_percent)/100)::integer;
    v_total:=v_total+v_unit::bigint*v_item.quantity;
    if v_total>2147483647 then raise exception 'total_too_large' using errcode='22023'; end if;
    select image_url into v_image from public.product_images where color_id=v_color.id
      order by (angle='front') desc,sort_order,id limit 1;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('name',v_product.name,'color_name',v_color.color_name,
      'color_hex',v_color.color_hex,'image_url',v_image,'quantity',v_item.quantity,'unit_price',v_unit,'line_total',v_unit::bigint*v_item.quantity));
  end loop;
  insert into public.pos_quotations(client_uuid,created_by,staff_name,customer_name,customer_phone,subtotal,total,items,request_items)
    values(p_client_uuid,v_staff.id,v_staff.name,trim(p_customer_name),p_customer_phone,v_total::integer,v_total::integer,v_lines,v_payload) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.pos_create_quotation(uuid,text,text,jsonb) from public,anon;
grant execute on function public.pos_create_quotation(uuid,text,text,jsonb) to authenticated;

create function public.pos_create_receipt_document(p_client_uuid uuid,p_sale_id uuid,p_customer_name text,p_customer_phone text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_staff public.pos_users%rowtype; v_sale public.pos_sales%rowtype; v_existing public.pos_receipt_documents%rowtype;
  v_id uuid; v_items jsonb;
begin
  select * into v_staff from public.pos_users where auth_user_id=auth.uid() and active for share;
  if not found then raise exception 'not_authorized' using errcode='42501'; end if;
  if p_client_uuid is null or length(trim(coalesce(p_customer_name,''))) not between 1 and 200
    or coalesce(p_customer_phone,'') !~ '^[1-9][0-9]{7,14}$' then raise exception 'invalid_customer' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_uuid::text,2));
  select * into v_existing from public.pos_receipt_documents where client_uuid=p_client_uuid;
  if found then
    if v_existing.created_by<>v_staff.id or v_existing.sale_id is distinct from p_sale_id or v_existing.customer_name<>trim(p_customer_name)
      or v_existing.customer_phone<>p_customer_phone then raise exception 'idempotency_mismatch' using errcode='22023'; end if;
    return v_existing.id;
  end if;
  select * into v_sale from public.pos_sales where id=p_sale_id and payment_status='paid';
  if not found then raise exception 'paid_sale_not_found' using errcode='P0002'; end if;
  select jsonb_agg(jsonb_build_object('name',i.name,'color_name',i.color_name,'color_hex',c.color_hex,
    'image_url',(select image_url from public.product_images where color_id=i.color_id order by (angle='front') desc,sort_order,id limit 1),
    'quantity',i.quantity,'unit_price',i.unit_price,'line_total',i.line_total) order by i.id)
    into v_items from public.pos_sale_items i left join public.product_colors c on c.id=i.color_id where i.sale_id=v_sale.id;
  if v_items is null then raise exception 'sale_items_missing' using errcode='22023'; end if;
  insert into public.pos_receipt_documents(client_uuid,sale_id,created_by,staff_name,customer_name,customer_phone,subtotal,discount_amount,total,items,sale_created_at)
    values(p_client_uuid,v_sale.id,v_staff.id,v_sale.staff_name,trim(p_customer_name),p_customer_phone,v_sale.subtotal,v_sale.discount_amount,v_sale.total,v_items,v_sale.created_at) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.pos_create_receipt_document(uuid,uuid,text,text) from public,anon;
grant execute on function public.pos_create_receipt_document(uuid,uuid,text,text) to authenticated;
commit;
