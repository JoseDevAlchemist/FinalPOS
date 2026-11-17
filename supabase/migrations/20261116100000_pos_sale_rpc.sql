-- Phase 3 cash commit. Colour stock remains authoritative; product stock is
-- its aggregate projection, maintained for sales and existing restock paths.
alter table public.products
  add column stock_quantity integer not null default 0 check (stock_quantity >= 0);

update public.products p set stock_quantity = (
  select coalesce(sum(c.stock_quantity), 0)
  from public.product_colors c where c.product_id = p.id
);

create function public.pos_project_product_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Apply deltas while holding the product row lock; recomputing SUM here
  -- could lose a concurrent colour change under READ COMMITTED snapshots.
  if tg_op <> 'INSERT' then
    update public.products set stock_quantity = stock_quantity - old.stock_quantity
      where id = old.product_id;
  end if;
  if tg_op <> 'DELETE' then
    update public.products set stock_quantity = stock_quantity + new.stock_quantity
      where id = new.product_id;
  end if;
  return null;
end;
$$;
revoke all on function public.pos_project_product_stock() from public, anon, authenticated;
create trigger pos_project_product_stock
  after insert or delete or update of stock_quantity, product_id
  on public.product_colors for each row
  execute function public.pos_project_product_stock();

create table public.pos_sale_audit (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null unique references public.pos_sales(id),
  actor_staff_id uuid not null references public.pos_users(id),
  event text not null check (event = 'cash_sale_recorded'),
  created_at timestamptz not null default now()
);
alter table public.pos_sale_audit enable row level security;
revoke all on public.pos_sale_audit from anon, authenticated;
grant select on public.pos_sale_audit to authenticated;
create policy "Managers can read sale audit" on public.pos_sale_audit
  for select to authenticated using (public.pos_is_manager());

create function public.pos_record_sale(
  p_client_uuid uuid,
  p_cashier_id uuid,
  p_total_kes integer,
  p_payment_method text,
  p_amount_tendered integer,
  p_items jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.pos_users%rowtype;
  v_sale_id uuid;
  v_product public.products%rowtype;
  v_color public.product_colors%rowtype;
  v_item record;
  v_unit integer;
  v_total bigint := 0;
  v_after integer;
begin
  select * into v_staff from public.pos_users
    where auth_user_id = auth.uid() and active for share;
  if not found or p_cashier_id is distinct from v_staff.id then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_client_uuid is null or p_total_kes is null or p_total_kes < 0
     or p_payment_method is distinct from 'cash'
     or p_amount_tendered is null or p_amount_tendered < 0 then
    raise exception 'invalid_cash_sale' using errcode = '22023';
  end if;

  -- Claim the UUID before touching stock. A concurrent retry waits here for
  -- the first transaction, then returns false without repricing historical data.
  insert into public.pos_sales (
    client_uuid, staff_id, staff_name, subtotal, total,
    payment_method, payment_status, cash_tendered, change_due, paid_at
  ) values (
    p_client_uuid, v_staff.id, v_staff.name, p_total_kes, p_total_kes,
    'cash', 'paid', p_amount_tendered, 0, now()
  ) on conflict (client_uuid) do nothing returning id into v_sale_id;

  if v_sale_id is null then
    if not exists (select 1 from public.pos_sales
      where client_uuid = p_client_uuid and staff_id = v_staff.id) then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
    return false;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'cart_empty_or_too_large' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) i
    where jsonb_typeof(i) is distinct from 'object'
      or jsonb_typeof(i->'product_id') is distinct from 'string'
      or jsonb_typeof(i->'color_id') is distinct from 'string'
      or jsonb_typeof(i->'quantity') is distinct from 'number'
      or jsonb_typeof(i->'price_at_sale') is distinct from 'number'
      or (i->>'quantity') !~ '^[0-9]+$'
      or (i->>'price_at_sale') !~ '^[0-9]+$'
  ) then
    raise exception 'invalid_items' using errcode = '22023';
  end if;

  -- Consistent lock order prevents two carts with reversed item order from
  -- deadlocking. Product edits cannot change prices during validation.
  perform p.id from public.products p
    where p.id in (select x.product_id from jsonb_to_recordset(p_items)
      as x(product_id uuid)) order by p.id for update;
  perform c.id from public.product_colors c
    where c.id in (select x.color_id from jsonb_to_recordset(p_items)
      as x(color_id uuid)) order by c.id for update;

  for v_item in select * from jsonb_to_recordset(p_items)
    as x(product_id uuid, color_id uuid, quantity integer, price_at_sale integer)
  loop
    if v_item.quantity < 1 or v_item.quantity > 1000 then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;
    select * into v_product from public.products where id = v_item.product_id and active;
    if not found then
      raise exception 'product_unavailable' using errcode = 'P0002';
    end if;
    select * into v_color from public.product_colors
      where id = v_item.color_id and product_id = v_product.id;
    if not found then
      raise exception 'color_not_found' using errcode = 'P0002';
    end if;

    v_unit := round(v_product.base_price::numeric * (100 - v_product.discount_percent) / 100)::integer;
    if v_item.price_at_sale is distinct from v_unit then
      raise exception 'price_mismatch' using errcode = '22023';
    end if;
    v_total := v_total + v_unit::bigint * v_item.quantity;
    if v_total > 2147483647 then
      raise exception 'total_too_large' using errcode = '22023';
    end if;

    update public.product_colors set stock_quantity = stock_quantity - v_item.quantity
      where id = v_color.id and stock_quantity >= v_item.quantity
      returning stock_quantity into v_after;
    if not found then
      raise exception 'insufficient_stock:%', v_product.name using errcode = '23514';
    end if;
    -- The projection trigger decrements products.stock_quantity in this same
    -- transaction. Both stock projections roll back if any later check fails.
    insert into public.stock_movements (
      product_id, color_id, delta, quantity_after, reason, actor_staff_id
    ) values (
      v_product.id, v_color.id, -v_item.quantity, v_after,
      'sale:' || p_client_uuid::text, v_staff.id
    );
    insert into public.pos_sale_items (
      sale_id, product_id, color_id, name, color_name, barcode,
      unit_price, quantity, line_total
    ) values (
      v_sale_id, v_product.id, v_color.id, v_product.name, v_color.color_name,
      v_product.barcode, v_unit, v_item.quantity, v_unit * v_item.quantity
    );
  end loop;

  if p_total_kes is distinct from v_total then
    raise exception 'total_mismatch' using errcode = '22023';
  end if;
  if p_amount_tendered < v_total then
    raise exception 'insufficient_cash' using errcode = '22023';
  end if;
  update public.pos_sales set subtotal = v_total, total = v_total,
    change_due = p_amount_tendered - v_total where id = v_sale_id;
  insert into public.pos_sale_audit(sale_id, actor_staff_id, event)
    values (v_sale_id, v_staff.id, 'cash_sale_recorded');
  return true;
end;
$$;
revoke all on function public.pos_record_sale(uuid, uuid, integer, text, integer, jsonb)
  from public, anon;
grant execute on function public.pos_record_sale(uuid, uuid, integer, text, integer, jsonb)
  to authenticated;

-- Retire the alternate money-write entry point after upgrading the caller.
revoke execute on function public.pos_create_sale(uuid, jsonb, text, integer, integer)
  from public, anon, authenticated;
