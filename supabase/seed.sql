-- Local development staff. These PINs are throwaway credentials and must never
-- be seeded into a shared or production project.
--
--   Brian Otieno   cashier   1234
--   Grace Wanjiru  manager   4826
--
-- After `supabase db reset`, run `pnpm auth:link` to create the matching
-- Supabase Auth users and populate auth_user_id.

insert into public.pos_users (id, name, pin_hash, role, active)
values
  (
    'a1c9f1e2-0000-4000-8000-000000000001',
    'Brian Otieno',
    '$2b$10$Raiee28ncUq4J5ComgyiOeuUnl24wqUbA3A13RtCtNi03N3b26C.a',
    'cashier',
    true
  ),
  (
    'a1c9f1e2-0000-4000-8000-000000000002',
    'Grace Wanjiru',
    '$2b$10$R0ovDPF9brBujL97lLrUdeTmCrk4CE/yjd/wQBU86rnODsudNYFEq',
    'manager',
    true
  )
on conflict (id) do nothing;

-- Local catalogue fixtures for Phase 3. Fixed ids keep the seed repeatable and
-- let the barcode/price checks address a known row after `supabase db reset`.
insert into public.products (
  id, name, slug, description, category, base_price, discount_percent,
  featured, active, barcode, is_website_published
)
values
  (
    'c0a80101-0000-4000-8000-000000000001',
    'Karura Tote',
    'karura-tote',
    'A structured everyday tote in full-grain leather.',
    'bag',
    12500,
    0,
    true,
    true,
    'PED-KARURA-001',
    true
  ),
  (
    'c0a80101-0000-4000-8000-000000000002',
    'Ngong Loafer',
    'ngong-loafer',
    'A soft unlined loafer with a leather sole.',
    'shoe',
    9800,
    5,
    false,
    true,
    'PED-NGONG-002',
    true
  ),
  (
    'c0a80101-0000-4000-8000-000000000003',
    'Draft Weekender',
    'draft-weekender',
    'Not yet published to the storefront.',
    'bag',
    18000,
    0,
    false,
    true,
    'PED-DRAFT-003',
    false
  )
on conflict (id) do nothing;

insert into public.product_colors (
  id, product_id, color_name, color_hex, sort_order, stock_quantity
)
values
  (
    'c0a80201-0000-4000-8000-000000000001',
    'c0a80101-0000-4000-8000-000000000001',
    'Tan',
    '#8b4513',
    0,
    4
  ),
  (
    'c0a80201-0000-4000-8000-000000000002',
    'c0a80101-0000-4000-8000-000000000001',
    'Black',
    '#1f1f1f',
    1,
    2
  ),
  (
    'c0a80201-0000-4000-8000-000000000003',
    'c0a80101-0000-4000-8000-000000000002',
    'Brown',
    '#5d4037',
    0,
    3
  ),
  (
    'c0a80201-0000-4000-8000-000000000004',
    'c0a80101-0000-4000-8000-000000000002',
    'Black',
    '#1f1f1f',
    1,
    0
  ),
  (
    'c0a80201-0000-4000-8000-000000000005',
    'c0a80101-0000-4000-8000-000000000003',
    'Olive',
    '#556b2f',
    0,
    5
  )
on conflict (id) do nothing;
