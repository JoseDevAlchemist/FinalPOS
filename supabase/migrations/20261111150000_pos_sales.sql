-- ===========================================================================
-- 20261111150000_pos_sales.sql — core POS sales, settings, payments
-- ===========================================================================

create extension if not exists pgcrypto;

-- Shop settings (shared). Minimal table for exchange rate / config.
create table if not exists public.shop_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.pos_users (id) on delete set null
);

insert into public.shop_settings (key, value)
values ('exchange_rate', jsonb_build_object('kes_per_usd', 130))
on conflict (key) do nothing;

alter table public.shop_settings enable row level security;

drop policy if exists "Anyone can read shop settings" on public.shop_settings;
create policy "Anyone can read shop settings"
  on public.shop_settings
  for select
  to anon, authenticated
  using (true);

-- Requested: allow manager updates from the app; anon key must be able to save.
drop policy if exists "Anon can save shop settings" on public.shop_settings;
create policy "Anon can save shop settings"
  on public.shop_settings
  for all
  to anon
  using (true)
  with check (true);

drop policy if exists "Managers can save shop settings" on public.shop_settings;
create policy "Managers can save shop settings"
  on public.shop_settings
  for all
  to authenticated
  using (public.pos_is_manager())
  with check (public.pos_is_manager());

grant select on table public.shop_settings to anon, authenticated;
grant insert, update on table public.shop_settings to anon, authenticated;

-- Sales
create table if not exists public.pos_sales (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid not null unique,
  staff_id uuid not null references public.pos_users (id),
  staff_name text not null,
  subtotal integer not null check (subtotal >= 0),
  discount_percent integer not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
  discount_amount integer not null default 0 check (discount_amount >= 0),
  total integer not null check (total >= 0),
  payment_method text not null check (payment_method in ('cash', 'mpesa', 'card')),
  payment_status text not null check (payment_status in ('pending', 'paid', 'failed', 'cancelled')),
  cash_tendered integer check (cash_tendered is null or cash_tendered >= 0),
  change_due integer check (change_due is null or change_due >= 0),
  mpesa_phone text,
  mpesa_checkout_request_id text,
  mpesa_merchant_request_id text,
  mpesa_receipt text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists idx_pos_sales_created_at on public.pos_sales (created_at desc);
create index if not exists idx_pos_sales_staff on public.pos_sales (staff_id, created_at desc);
create index if not exists idx_pos_sales_checkout on public.pos_sales (mpesa_checkout_request_id) where mpesa_checkout_request_id is not null;

create table if not exists public.pos_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.pos_sales (id) on delete cascade,
  product_id uuid not null references public.products (id),
  color_id uuid references public.product_colors (id),
  name text not null,
  color_name text,
  barcode text,
  unit_price integer not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  line_total integer not null check (line_total >= 0)
);

create index if not exists idx_pos_sale_items_sale on public.pos_sale_items (sale_id);

alter table public.pos_sales enable row level security;
alter table public.pos_sale_items enable row level security;

drop policy if exists "Staff can read pos sales" on public.pos_sales;
create policy "Staff can read pos sales"
  on public.pos_sales for select to authenticated
  using (public.pos_is_staff());

drop policy if exists "Staff can read pos sale items" on public.pos_sale_items;
create policy "Staff can read pos sale items"
  on public.pos_sale_items for select to authenticated
  using (public.pos_is_staff());

-- service role / RPC handles writes; block direct client writes
revoke insert, update, delete, truncate, references, trigger on table public.pos_sales, public.pos_sale_items from anon, authenticated;
grant select on table public.pos_sales, public.pos_sale_items to authenticated;

-- Server-priced, idempotent sale creation
create or replace function public.pos_create_sale(
  p_client_uuid uuid,
  p_cart_items jsonb,
  p_payment_method text,
  p_cash_tendered integer default null,
  p_discount_percent integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff record;
  v_sale public.pos_sales%rowtype;
  v_item jsonb;
  v_product record;
  v_color record;
  v_qty integer;
  v_unit integer;
  v_line integer;
  v_subtotal integer := 0;
  v_discount integer := 0;
  v_total integer := 0;
  v_change integer := null;
  v_status text;
  v_paid_at timestamptz := null;
  v_items jsonb := '[]'::jsonb;
begin
  if not public.pos_is_staff() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_client_uuid is null then
    raise exception 'client_uuid_required' using errcode = '22023';
  end if;

  select * into v_sale from public.pos_sales where client_uuid = p_client_uuid for update;
  if found then
    select jsonb_agg(jsonb_build_object(
      'name', name, 'quantity', quantity, 'unit_price', unit_price, 'line_total', line_total, 'color_name', color_name
    )) into v_items from public.pos_sale_items where sale_id = v_sale.id;

    return jsonb_build_object(
      'id', v_sale.id,
      'client_uuid', v_sale.client_uuid,
      'staff_name', v_sale.staff_name,
      'subtotal', v_sale.subtotal,
      'discount_percent', v_sale.discount_percent,
      'discount_amount', v_sale.discount_amount,
      'total', v_sale.total,
      'payment_method', v_sale.payment_method,
      'payment_status', v_sale.payment_status,
      'cash_tendered', v_sale.cash_tendered,
      'change_due', v_sale.change_due,
      'created_at', v_sale.created_at,
      'items', coalesce(v_items, '[]'::jsonb),
      'idempotent', true
    );
  end if;

  select id, name, role, active into v_staff
  from public.pos_users
  where auth_user_id = auth.uid() and active;

  if not found then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_payment_method not in ('cash', 'mpesa', 'card') then
    raise exception 'invalid_payment_method' using errcode = '22023';
  end if;

  if p_discount_percent is null or p_discount_percent < 0 or p_discount_percent > 100 then
    raise exception 'invalid_discount' using errcode = '22023';
  end if;

  if p_cart_items is null or jsonb_typeof(p_cart_items) <> 'array' or jsonb_array_length(p_cart_items) = 0 then
    raise exception 'cart_empty' using errcode = '22023';
  end if;

  v_status := case when p_payment_method = 'mpesa' then 'pending' else 'paid' end;
  v_paid_at := case when p_payment_method = 'mpesa' then null else now() end;

  -- lock and validate items
  create temporary table tmp_sale_lines (
    product_id uuid,
    color_id uuid,
    name text,
    color_name text,
    barcode text,
    unit_price integer,
    quantity integer,
    line_total integer
  ) on commit drop;

  for v_item in select value from jsonb_array_elements(p_cart_items)
  loop
    v_qty := (v_item ->> 'quantity')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;

    select id, name, base_price, discount_percent, barcode, active
      into v_product
      from public.products
      where id = (v_item ->> 'product_id')::uuid
      for update;

    if not found or not v_product.active then
      raise exception 'product_unavailable' using errcode = 'P0002';
    end if;

    -- choose color: explicit if provided, else single color, else first with enough stock
    if nullif(v_item ->> 'color_id', '') is not null then
      select id, color_name, stock_quantity into v_color
      from public.product_colors
      where id = (v_item ->> 'color_id')::uuid
        and product_id = v_product.id
      for update;
    else
      select id, color_name, stock_quantity into v_color
      from public.product_colors
      where product_id = v_product.id
      order by (stock_quantity >= v_qty) desc, sort_order asc
      limit 1
      for update;
    end if;

    if v_color.id is null then
      raise exception 'color_not_found' using errcode = 'P0002';
    end if;

    if v_color.stock_quantity < v_qty then
      raise exception 'insufficient_stock:%', v_product.name using errcode = '23514';
    end if;

    v_unit := round(v_product.base_price * (1 - coalesce(v_product.discount_percent, 0)::numeric / 100.0))::integer;
    v_line := v_unit * v_qty;
    v_subtotal := v_subtotal + v_line;

    update public.product_colors
      set stock_quantity = stock_quantity - v_qty
      where id = v_color.id;

    insert into public.stock_movements (product_id, color_id, delta, quantity_after, reason, actor_staff_id)
    values (v_product.id, v_color.id, -v_qty, v_color.stock_quantity - v_qty, 'sale:' || p_client_uuid::text, v_staff.id);

    insert into tmp_sale_lines (product_id, color_id, name, color_name, barcode, unit_price, quantity, line_total)
    values (v_product.id, v_color.id, v_product.name, v_color.color_name, v_product.barcode, v_unit, v_qty, v_line);
  end loop;

  v_discount := round(v_subtotal * p_discount_percent::numeric / 100.0)::integer;
  v_total := greatest(v_subtotal - v_discount, 0);

  if p_payment_method = 'cash' then
    if p_cash_tendered is null or p_cash_tendered < v_total then
      raise exception 'insufficient_cash' using errcode = '22023';
    end if;
    v_change := p_cash_tendered - v_total;
  end if;

  insert into public.pos_sales (
    client_uuid, staff_id, staff_name, subtotal, discount_percent, discount_amount, total,
    payment_method, payment_status, cash_tendered, change_due, paid_at
  )
  values (
    p_client_uuid, v_staff.id, v_staff.name, v_subtotal, p_discount_percent, v_discount, v_total,
    p_payment_method, v_status, p_cash_tendered, v_change, v_paid_at
  )
  returning * into v_sale;

  insert into public.pos_sale_items (sale_id, product_id, color_id, name, color_name, barcode, unit_price, quantity, line_total)
  select v_sale.id, product_id, color_id, name, color_name, barcode, unit_price, quantity, line_total
  from tmp_sale_lines;

  select jsonb_agg(jsonb_build_object(
    'name', name, 'quantity', quantity, 'unit_price', unit_price, 'line_total', line_total, 'color_name', color_name
  )) into v_items from tmp_sale_lines;

  return jsonb_build_object(
    'id', v_sale.id,
    'client_uuid', v_sale.client_uuid,
    'staff_name', v_sale.staff_name,
    'subtotal', v_sale.subtotal,
    'discount_percent', v_sale.discount_percent,
    'discount_amount', v_sale.discount_amount,
    'total', v_sale.total,
    'payment_method', v_sale.payment_method,
    'payment_status', v_sale.payment_status,
    'cash_tendered', v_sale.cash_tendered,
    'change_due', v_sale.change_due,
    'created_at', v_sale.created_at,
    'items', coalesce(v_items, '[]'::jsonb),
    'idempotent', false
  );
exception
  when unique_violation then
    select * into v_sale from public.pos_sales where client_uuid = p_client_uuid;
    if found then
      select jsonb_agg(jsonb_build_object(
        'name', name, 'quantity', quantity, 'unit_price', unit_price, 'line_total', line_total, 'color_name', color_name
      )) into v_items from public.pos_sale_items where sale_id = v_sale.id;
      return jsonb_build_object(
        'id', v_sale.id,
        'client_uuid', v_sale.client_uuid,
        'staff_name', v_sale.staff_name,
        'subtotal', v_sale.subtotal,
        'discount_percent', v_sale.discount_percent,
        'discount_amount', v_sale.discount_amount,
        'total', v_sale.total,
        'payment_method', v_sale.payment_method,
        'payment_status', v_sale.payment_status,
        'cash_tendered', v_sale.cash_tendered,
        'change_due', v_sale.change_due,
        'created_at', v_sale.created_at,
        'items', coalesce(v_items, '[]'::jsonb),
        'idempotent', true
      );
    end if;
    raise;
end;
$$;

revoke all on function public.pos_create_sale(uuid, jsonb, text, integer, integer) from public;
grant execute on function public.pos_create_sale(uuid, jsonb, text, integer, integer) to authenticated;
