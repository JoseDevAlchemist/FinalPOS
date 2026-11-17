-- ===========================================================================
-- 20261111140000_pos_catalogue.sql — product editing, barcodes, stock control
-- ===========================================================================
--
-- This migration is additive against the shared storefront schema. The local
-- project starts from an empty database, so the `CREATE TABLE IF NOT EXISTS`
-- blocks also serve as the local baseline. On the shared project they are
-- no-ops and the `IF NOT EXISTS` column additions only fill gaps left by the
-- storefront/POS migrations that have not run yet.
--
-- The storefront owns `products`, `product_colors` and `product_images`.
-- Nothing here changes their column meaning. It adds the POS-only barcode and
-- publication flag, restricts writes to narrow manager RPCs, and adds a stock
-- movement ledger for the till's quick-restock path.
-- ===========================================================================

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  category text not null check (category in ('bag', 'shoe')),
  base_price integer not null check (base_price >= 0),
  base_price_usd integer,
  discount_percent integer not null default 0
    check (discount_percent >= 0 and discount_percent <= 100),
  featured boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.products
  add column if not exists barcode text,
  add column if not exists is_website_published boolean not null default false;

create unique index if not exists idx_products_barcode
  on public.products (barcode)
  where barcode is not null;

create table if not exists public.product_colors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  color_name text not null,
  color_hex text not null,
  sort_order integer not null default 0,
  unique (product_id, color_name)
);

alter table public.product_colors
  add column if not exists stock_quantity integer not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_colors_stock_quantity_check'
      and conrelid = 'public.product_colors'::regclass
  ) then
    alter table public.product_colors
      add constraint product_colors_stock_quantity_check
      check (stock_quantity >= 0);
  end if;
end
$$;

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  color_id uuid not null references public.product_colors (id) on delete cascade,
  angle text not null check (
    angle in ('front', 'side-left', 'side-right', 'side', 'top', 'bottom', 'back', 'laces')
  ),
  image_url text,
  sort_order integer not null default 0,
  unique (color_id, angle)
);

create index if not exists idx_products_category on public.products (category);
create index if not exists idx_products_active on public.products (active);
create index if not exists idx_products_active_created
  on public.products (active, created_at desc);
create index if not exists idx_colors_product on public.product_colors (product_id);
create index if not exists idx_colors_product_stock
  on public.product_colors (product_id, stock_quantity);
create index if not exists idx_images_color on public.product_images (color_id);
create index if not exists idx_images_color_angle
  on public.product_images (color_id, angle);

-- The storefront dropped product-level stock in 022. Local databases need the
-- old column removed only when it is safe; the DO block is deliberately omitted
-- because a shared project may still have it while the storefront migration is
-- being rolled out. The POS reads and writes colour stock only.

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  color_id uuid references public.product_colors (id) on delete set null,
  delta integer not null check (delta <> 0),
  quantity_after integer not null check (quantity_after >= 0),
  reason text not null default 'quick_restock',
  actor_staff_id uuid references public.pos_users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.stock_movements
  add column if not exists color_id uuid references public.product_colors (id) on delete set null;

create index if not exists idx_stock_movements_product
  on public.stock_movements (product_id, created_at desc);
create index if not exists idx_stock_movements_color
  on public.stock_movements (color_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Staff helper
-- ---------------------------------------------------------------------------
create or replace function public.pos_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.pos_users
    where auth_user_id = auth.uid()
      and active
  );
$$;

revoke all on function public.pos_is_staff() from public;
grant execute on function public.pos_is_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.products enable row level security;
alter table public.product_colors enable row level security;
alter table public.product_images enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists "Public can read active products" on public.products;
create policy "Public can read active products"
  on public.products
  for select
  to anon, authenticated
  using (active and is_website_published);

drop policy if exists "Public can read colors of active products" on public.product_colors;
create policy "Public can read colors of active products"
  on public.product_colors
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_id
        and p.active
        and p.is_website_published
    )
  );

drop policy if exists "Public can read images of active products" on public.product_images;
create policy "Public can read images of active products"
  on public.product_images
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.product_colors pc
      join public.products p on p.id = pc.product_id
      where pc.id = color_id
        and p.active
        and p.is_website_published
    )
  );

drop policy if exists "Authenticated full access products" on public.products;
drop policy if exists "Authenticated full access colors" on public.product_colors;
drop policy if exists "Authenticated full access images" on public.product_images;

drop policy if exists "POS staff can read products" on public.products;
create policy "POS staff can read products"
  on public.products
  for select
  to authenticated
  using (public.pos_is_staff());

drop policy if exists "POS staff can read product colors" on public.product_colors;
create policy "POS staff can read product colors"
  on public.product_colors
  for select
  to authenticated
  using (public.pos_is_staff());

drop policy if exists "POS staff can read product images" on public.product_images;
create policy "POS staff can read product images"
  on public.product_images
  for select
  to authenticated
  using (public.pos_is_staff());

drop policy if exists "Managers can read stock movements" on public.stock_movements;
create policy "Managers can read stock movements"
  on public.stock_movements
  for select
  to authenticated
  using (public.pos_is_manager());

revoke insert, update, delete, truncate, references, trigger
  on table public.products, public.product_colors, public.product_images
  from anon, authenticated;

grant select on table public.products, public.product_colors, public.product_images
  to anon, authenticated;

revoke all on table public.stock_movements from anon, authenticated;
grant select on table public.stock_movements to authenticated;

-- ---------------------------------------------------------------------------
-- Manager product update
-- ---------------------------------------------------------------------------
-- Replaces the editable product fields and the colour/image set in one
-- transaction. Colour stock is not accepted from the client: existing colours
-- keep their current quantity by id, and new colours start at zero. Stock only
-- changes through `pos_manager_adjust_color_stock`, which writes the ledger.
create or replace function public.pos_manager_update_product(
  p_product_id uuid,
  p_name text,
  p_description text,
  p_category text,
  p_base_price integer,
  p_discount_percent integer,
  p_barcode text,
  p_active boolean,
  p_is_website_published boolean,
  p_colors jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barcode text;
  v_color jsonb;
  v_image jsonb;
  v_color_id uuid;
  v_color_name text;
  v_old_stock jsonb := '{}'::jsonb;
  v_seen_names text[] := '{}'::text[];
  v_sort integer := 0;
  v_image_sort integer;
  v_angle text;
begin
  if not public.pos_is_manager() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_product_id is null or not exists (
    select 1 from public.products where id = p_product_id
  ) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'A product needs a name' using errcode = '23514';
  end if;

  if p_base_price is null or p_base_price < 0 then
    raise exception 'Price cannot be negative' using errcode = '23514';
  end if;

  if p_discount_percent is null
     or p_discount_percent < 0
     or p_discount_percent > 100 then
    raise exception 'Discount must be between 0 and 100' using errcode = '23514';
  end if;

  if p_category is null or p_category not in ('bag', 'shoe') then
    raise exception 'Unknown category' using errcode = '23514';
  end if;

  if p_colors is null
     or jsonb_typeof(p_colors) <> 'array'
     or jsonb_array_length(p_colors) = 0 then
    raise exception 'A product needs at least one colour' using errcode = '23514';
  end if;

  v_barcode := nullif(trim(coalesce(p_barcode, '')), '');

  if v_barcode is not null and exists (
    select 1
    from public.products
    where barcode = v_barcode
      and id <> p_product_id
  ) then
    raise exception 'barcode_taken' using errcode = '23505';
  end if;

  select coalesce(jsonb_object_agg(id::text, stock_quantity), '{}'::jsonb)
  into v_old_stock
  from public.product_colors
  where product_id = p_product_id;

  update public.products
  set name = trim(p_name),
      description = coalesce(p_description, ''),
      category = p_category,
      base_price = p_base_price,
      discount_percent = p_discount_percent,
      barcode = v_barcode,
      active = coalesce(p_active, true),
      is_website_published = coalesce(p_is_website_published, false)
  where id = p_product_id;

  delete from public.product_colors where product_id = p_product_id;

  for v_color in
    select value from jsonb_array_elements(p_colors)
  loop
    v_color_name := trim(coalesce(v_color ->> 'name', ''));

    if v_color_name = '' then
      raise exception 'Every colour needs a name' using errcode = '23514';
    end if;

    if v_color_name = any (v_seen_names) then
      raise exception 'Two colours have the same name' using errcode = '23505';
    end if;

    v_seen_names := array_append(v_seen_names, v_color_name);

    if coalesce(v_color ->> 'hex', '') !~ '^#[0-9A-Fa-f]{6}$' then
      raise exception 'Colour hex must look like #8B4513' using errcode = '23514';
    end if;

    if nullif(v_color ->> 'id', '') is not null then
      if (v_color ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Invalid colour id' using errcode = '23514';
      end if;

      if not (v_old_stock ? (v_color ->> 'id')) then
        raise exception 'color_not_found' using errcode = 'P0002';
      end if;
    end if;

    insert into public.product_colors (
      id,
      product_id,
      color_name,
      color_hex,
      sort_order,
      stock_quantity
    )
    values (
      coalesce(nullif(v_color ->> 'id', '')::uuid, gen_random_uuid()),
      p_product_id,
      v_color_name,
      lower(v_color ->> 'hex'),
      v_sort,
      coalesce((v_old_stock ->> (v_color ->> 'id'))::integer, 0)
    )
    returning id into v_color_id;

    v_image_sort := 0;

    for v_image in
      select value from jsonb_array_elements(coalesce(v_color -> 'images', '[]'::jsonb))
    loop
      v_angle := v_image ->> 'angle';

      if v_angle is null or v_angle not in (
        'front', 'side-left', 'side-right', 'side', 'top', 'bottom', 'back', 'laces'
      ) then
        raise exception 'Unknown image angle' using errcode = '23514';
      end if;

      insert into public.product_images (
        color_id,
        angle,
        image_url,
        sort_order
      )
      values (
        v_color_id,
        v_angle,
        nullif(trim(coalesce(v_image ->> 'image_url', '')), ''),
        v_image_sort
      );

      v_image_sort := v_image_sort + 1;
    end loop;

    v_sort := v_sort + 1;
  end loop;

  return p_product_id;
exception
  when unique_violation then
    raise exception 'catalogue_conflict' using errcode = '23505';
end;
$$;

comment on function public.pos_manager_update_product(
  uuid, text, text, text, integer, integer, text, boolean, boolean, jsonb
) is
  'Manager-only product edit. Preserves colour stock by colour id and replaces images atomically. Stock changes use pos_manager_adjust_color_stock.';

revoke all on function public.pos_manager_update_product(
  uuid, text, text, text, integer, integer, text, boolean, boolean, jsonb
) from public;
grant execute on function public.pos_manager_update_product(
  uuid, text, text, text, integer, integer, text, boolean, boolean, jsonb
) to authenticated;

-- ---------------------------------------------------------------------------
-- Manager quick restock
-- ---------------------------------------------------------------------------
create or replace function public.pos_manager_adjust_color_stock(
  p_product_id uuid,
  p_color_id uuid,
  p_delta integer,
  p_reason text default 'quick_restock'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff_id uuid;
  v_after integer;
  v_reason text;
begin
  if not public.pos_is_manager() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then
    raise exception 'Stock adjustment must be a non-zero, sensible quantity'
      using errcode = '23514';
  end if;

  v_reason := coalesce(nullif(trim(p_reason), ''), 'quick_restock');

  if length(v_reason) > 200 then
    raise exception 'Stock reason is too long' using errcode = '23514';
  end if;

  select id into v_staff_id
  from public.pos_users
  where auth_user_id = auth.uid()
    and active
    and role = 'manager';

  update public.product_colors
  set stock_quantity = stock_quantity + p_delta
  where id = p_color_id
    and product_id = p_product_id
    and stock_quantity + p_delta >= 0
  returning stock_quantity into v_after;

  if not found then
    if exists (
      select 1 from public.product_colors
      where id = p_color_id and product_id = p_product_id
    ) then
      raise exception 'insufficient_stock' using errcode = '23514';
    end if;

    raise exception 'color_not_found' using errcode = 'P0002';
  end if;

  insert into public.stock_movements (
    product_id,
    color_id,
    delta,
    quantity_after,
    reason,
    actor_staff_id
  )
  values (
    p_product_id,
    p_color_id,
    p_delta,
    v_after,
    v_reason,
    v_staff_id
  );

  return v_after;
end;
$$;

comment on function public.pos_manager_adjust_color_stock(uuid, uuid, integer, text) is
  'Manager-only atomic colour stock adjustment. Writes an auditable stock movement.';

revoke all on function public.pos_manager_adjust_color_stock(uuid, uuid, integer, text)
  from public;
grant execute on function public.pos_manager_adjust_color_stock(uuid, uuid, integer, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket for product photography
-- ---------------------------------------------------------------------------
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'product-images',
  'product-images',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
