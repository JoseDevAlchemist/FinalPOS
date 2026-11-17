-- Baseline for environments provisioned from this repository.
-- The shared production project already owns this table; IF NOT EXISTS makes
-- this migration a no-op there. It must not be used to "fix" drift in an
-- existing table — inspect the live column set first.

create extension if not exists pgcrypto;

create table if not exists public.pos_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pin_hash text not null,
  role text not null check (role in ('cashier', 'manager')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.pos_users is
  'POS staff roster. PIN hashes are verification material, never client-readable.';
