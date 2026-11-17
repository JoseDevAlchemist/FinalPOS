-- Manager-only returns preserve original sales and restore exact variant stock.
begin;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid='public.product_colors'::regclass
    and tgname='pos_project_product_stock' and tgenabled in ('O','A')) then
    raise exception 'The product stock projection trigger is required before enabling returns';
  end if;
end;
$$;

create table public.pos_returns (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid not null unique,
  sale_id uuid not null references public.pos_sales(id) on delete restrict,
  processed_by uuid not null references public.pos_users(id) on delete restrict,
  processed_by_name text not null,
  refund_amount integer not null check (refund_amount >= 0),
  reason text not null check (length(trim(reason)) between 1 and 500),
  request_items jsonb not null,
  created_at timestamptz not null default now()
);
create index pos_returns_sale_created on public.pos_returns(sale_id, created_at desc);
create table public.pos_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.pos_returns(id) on delete restrict,
  sale_item_id uuid not null references public.pos_sale_items(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  color_id uuid not null references public.product_colors(id) on delete restrict,
  product_name text not null,
  color_name text,
  quantity integer not null check (quantity > 0),
  refund_amount integer not null check (refund_amount >= 0),
  unique (return_id, sale_item_id)
);
create index pos_return_items_sale_item on public.pos_return_items(sale_item_id);
alter table public.pos_returns enable row level security;
alter table public.pos_return_items enable row level security;
revoke all on public.pos_returns, public.pos_return_items from public, anon, authenticated;
grant select on public.pos_returns, public.pos_return_items to authenticated;
create policy "Managers read returns" on public.pos_returns
  for select to authenticated using (public.pos_is_manager());
create policy "Managers read return items" on public.pos_return_items
  for select to authenticated using (public.pos_is_manager());

-- The same historical allocation feeds the read preview and the commit. Integer
-- differences allocate discount rounding exactly, including the last unit.
create function public.pos_returnable_items(p_sale_id uuid)
returns table (
  id uuid, product_id uuid, color_id uuid, name text, color_name text,
  quantity integer, unit_price integer, refund_budget integer, returned_quantity integer
) language sql stable security definer set search_path = '' as $$
  with lines as (
    select i.*, sum(i.line_total::numeric) over () as basis,
      sum(i.line_total::numeric) over (order by i.id rows unbounded preceding) as cumulative
    from public.pos_sale_items i where i.sale_id = p_sale_id
  )
  select l.id, l.product_id, l.color_id, l.name, l.color_name, l.quantity, l.unit_price,
    case when l.basis = 0 then 0 else
      (floor(s.total::numeric * l.cumulative / l.basis)
       - floor(s.total::numeric * (l.cumulative - l.line_total) / l.basis))::integer end,
    (select coalesce(sum(r.quantity),0)::integer from public.pos_return_items r where r.sale_item_id = l.id)
  from lines l join public.pos_sales s on s.id = l.sale_id;
$$;
revoke all on function public.pos_returnable_items(uuid) from public, anon, authenticated;

create function public.pos_return_sale_details(p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_sale public.pos_sales%rowtype;
begin
  if not public.pos_is_manager() then raise exception 'not_authorized' using errcode='42501'; end if;
  select * into v_sale from public.pos_sales where id=p_sale_id;
  if not found then raise exception 'sale_not_found' using errcode='P0002'; end if;
  if v_sale.payment_status <> 'paid' then raise exception 'sale_not_paid' using errcode='22023'; end if;
  return jsonb_build_object('id',v_sale.id,'staff_name',v_sale.staff_name,'total',v_sale.total,
    'payment_method',v_sale.payment_method,'created_at',v_sale.created_at,
    'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.pos_returnable_items(p_sale_id) i));
end;
$$;
revoke all on function public.pos_return_sale_details(uuid) from public, anon;
grant execute on function public.pos_return_sale_details(uuid) to authenticated;

create function public.pos_process_return(p_client_uuid uuid, p_sale_id uuid, p_reason text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_manager public.pos_users%rowtype; v_sale public.pos_sales%rowtype;
  v_existing public.pos_returns%rowtype; v_payload jsonb; v_item record;
  v_lines jsonb := '[]'::jsonb; v_total bigint := 0; v_refund integer;
  v_return_id uuid; v_after integer; v_basis numeric;
begin
  select * into v_manager from public.pos_users
    where auth_user_id=auth.uid() and active and role='manager' for share;
  if not found then raise exception 'not_authorized' using errcode='42501'; end if;
  if p_client_uuid is null or p_sale_id is null
    or length(trim(coalesce(p_reason,''))) not between 1 and 500 then
    raise exception 'invalid_return' using errcode='22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'invalid_return_items' using errcode='22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'invalid_return_items' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) i where jsonb_typeof(i) is distinct from 'object'
    or jsonb_typeof(i->'sale_item_id') is distinct from 'string'
    or jsonb_typeof(i->'quantity') is distinct from 'number'
    or coalesce(i->>'quantity','') !~ '^[0-9]+$') then
    raise exception 'invalid_return_items' using errcode='22023';
  end if;
  select jsonb_agg(jsonb_build_object('sale_item_id',i.sale_item_id,'quantity',i.quantity) order by i.sale_item_id)
    into v_payload from jsonb_to_recordset(p_items) as i(sale_item_id uuid,quantity integer);
  if exists(select 1 from jsonb_to_recordset(v_payload) as i(sale_item_id uuid,quantity integer)
    where i.sale_item_id is null or i.quantity not between 1 and 1000)
    or (select count(*) <> count(distinct i.sale_item_id) from jsonb_to_recordset(v_payload) as i(sale_item_id uuid,quantity integer)) then
    raise exception 'invalid_return_items' using errcode='22023';
  end if;

  -- Serialize this retry key, then all returns against a sale. Different requests
  -- for the same sold quantity cannot both pass the remaining-quantity check.
  perform pg_advisory_xact_lock(hashtextextended(p_client_uuid::text,0));
  select * into v_existing from public.pos_returns where client_uuid=p_client_uuid;
  if found then
    if v_existing.sale_id is distinct from p_sale_id or v_existing.processed_by <> v_manager.id
      or v_existing.reason <> trim(p_reason) or v_existing.request_items is distinct from v_payload then
      raise exception 'idempotency_mismatch' using errcode='22023';
    end if;
    return v_existing.id;
  end if;
  select * into v_sale from public.pos_sales where id=p_sale_id for update;
  if not found then raise exception 'sale_not_found' using errcode='P0002'; end if;
  if v_sale.payment_status <> 'paid' then raise exception 'sale_not_paid' using errcode='22023'; end if;
  select coalesce(sum(line_total::numeric),0) into v_basis from public.pos_sale_items where sale_id=p_sale_id;
  if v_sale.total > v_basis then raise exception 'invalid_sale_amounts' using errcode='22023'; end if;
  if (select count(*) from public.pos_sale_items s join jsonb_to_recordset(v_payload) as i(sale_item_id uuid,quantity integer)
    on i.sale_item_id=s.id where s.sale_id=p_sale_id) <> jsonb_array_length(v_payload) then
    raise exception 'item_not_in_sale' using errcode='22023';
  end if;
  -- Follow the sale/stock RPCs' product-before-colour lock order.
  perform p.id from public.products p where p.id in (
    select s.product_id from public.pos_sale_items s join jsonb_to_recordset(v_payload) as i(sale_item_id uuid,quantity integer) on i.sale_item_id=s.id
  ) order by p.id for update;
  perform c.id from public.product_colors c where c.id in (
    select s.color_id from public.pos_sale_items s join jsonb_to_recordset(v_payload) as i(sale_item_id uuid,quantity integer) on i.sale_item_id=s.id
  ) order by c.id for update;

  for v_item in select s.*, i.quantity as return_quantity from public.pos_returnable_items(p_sale_id) s
    join jsonb_to_recordset(v_payload) as i(sale_item_id uuid,quantity integer) on i.sale_item_id=s.id order by s.id
  loop
    if v_item.returned_quantity + v_item.return_quantity > v_item.quantity then
      raise exception 'return_quantity_exceeded' using errcode='23514';
    end if;
    if v_item.color_id is null or not exists(select 1 from public.product_colors
      where id=v_item.color_id and product_id=v_item.product_id) then
      raise exception 'original_color_missing' using errcode='23514';
    end if;
    v_refund := (floor(v_item.refund_budget::numeric * (v_item.returned_quantity + v_item.return_quantity) / v_item.quantity)
      - floor(v_item.refund_budget::numeric * v_item.returned_quantity / v_item.quantity))::integer;
    v_total := v_total + v_refund;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('sale_item_id',v_item.id,'product_id',v_item.product_id,
      'color_id',v_item.color_id,'product_name',v_item.name,'color_name',v_item.color_name,
      'quantity',v_item.return_quantity,'refund_amount',v_refund));
  end loop;
  if v_total + (select coalesce(sum(refund_amount),0) from public.pos_returns where sale_id=p_sale_id) > v_sale.total then
    raise exception 'refund_total_exceeded' using errcode='23514';
  end if;
  insert into public.pos_returns(client_uuid,sale_id,processed_by,processed_by_name,refund_amount,reason,request_items)
    values(p_client_uuid,p_sale_id,v_manager.id,v_manager.name,v_total::integer,trim(p_reason),v_payload) returning id into v_return_id;
  for v_item in select * from jsonb_to_recordset(v_lines)
    as i(sale_item_id uuid,product_id uuid,color_id uuid,product_name text,color_name text,quantity integer,refund_amount integer)
  loop
    insert into public.pos_return_items(return_id,sale_item_id,product_id,color_id,product_name,color_name,quantity,refund_amount)
      values(v_return_id,v_item.sale_item_id,v_item.product_id,v_item.color_id,v_item.product_name,v_item.color_name,v_item.quantity,v_item.refund_amount);
    update public.product_colors set stock_quantity=stock_quantity+v_item.quantity
      where id=v_item.color_id and product_id=v_item.product_id returning stock_quantity into v_after;
    -- Existing pos_project_product_stock trigger increments products.stock_quantity
    -- atomically. Updating it again here would double-restock the product.
    insert into public.stock_movements(product_id,color_id,delta,quantity_after,reason,actor_staff_id,reference_uuid)
      values(v_item.product_id,v_item.color_id,v_item.quantity,v_after,'return:'||v_return_id::text||' '||trim(p_reason),v_manager.id,v_return_id);
  end loop;
  return v_return_id;
end;
$$;
revoke all on function public.pos_process_return(uuid,uuid,text,jsonb) from public, anon;
grant execute on function public.pos_process_return(uuid,uuid,text,jsonb) to authenticated;
commit;
