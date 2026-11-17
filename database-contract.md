# Database Contract — Pedigree POS 2.0

**Status:** Phase 4 management RPCs and cash sales tested against local Supabase.
No changes have been applied to the shared/live project.
**Last updated:** 2026-11-17
**Related:** `architecture.md`, `AGENTS.md`

> **Source note.** This contract is derived from the master specification and a
> read-only inspection of the previous POS (`PedigreePOS/supabase/migrations`,
> `database-contract.md`, `lib/supabase/types.ts`). The live shared Supabase
> project has **not** been inspected from this repository. Treat every table,
> column, policy and RPC below as a target or hypothesis until it is confirmed
> with `supabase gen types typescript`, `pg_dump --schema-only` (read-only) or
> the dashboard. Never assume the old POS migrations describe production.
>
> **Phase 2 migrations in this repo:**
> `20261111130000_pos_users_base.sql`,
> `20261111130100_pos_users_auth_link.sql`,
> `20261111130200_pos_users_rls.sql`. They are additive for an existing
> `pos_users` table, but the RLS migration revokes legacy `anon` access and will
> stop the old POS reading PIN hashes. Review the live policy set before
> applying.

## 1. Contract principles

1. **Migrations are the source of truth.** A database provisioned from
   `supabase/migrations` must match this contract. Dashboard-only SQL is not a
   deployment step.
2. **Additive first.** New migrations start above the highest applied version in
   the shared project. Never edit an applied migration.
3. **`anon` is untrusted.** Possession of the publishable key proves nothing.
4. **No direct financial writes.** Sales, sale lines, returns, refunds, payments,
   stock movements and staff records are written only through narrow RPCs.
5. **`SECURITY DEFINER` is the boundary.** Pin `search_path`, revoke `PUBLIC`,
   authorise the caller inside the function, and write an audit row.
6. **Idempotency is explicit.** Every financial RPC takes a client-generated
   `uuid` and is safe to call again with the same payload.
7. **Money is integer KES.** No floats at the database boundary. Historical sale
   amounts are immutable.
8. **Stock is a ledger.** `products.stock_quantity` may remain as a cached
   projection, but every change has a `stock_movements` row.
9. **Shared schema needs storefront review.** `products`, `product_colors`,
   `product_images`, `orders`, `order_items`, `admin_users`, `shop_settings`,
   `delivery_zones` and storage policies are storefront-owned or shared.
10. **Tests ship with policies.** Every table/RPC below needs pgTAP or
    integration coverage before release.

## 2. Shared project inventory (to verify in Phase 2)

The table names below were observed in the previous POS migrations and the
storefront type file. **Confirm against live before writing a migration.**

### 2.1 Storefront-owned or shared

| Table | Observed purpose | POS access intent |
| --- | --- | --- |
| `products` | Catalogue, KES price, discount, stock, publication flag, barcode | Staff read authorised columns; managers write via RPC. Barcodes never exposed publicly. |
| `product_colors` | Colour variants | Read-only in POS (storefront owns). |
| `product_images` | Image rows linked to colours | Read-only in POS; manager upload via authorised path. |
| `shop_settings` | Storefront settings | Read-only unless an agreed key is promoted to shared config. |
| `orders` | Storefront orders | Active staff read for incoming-order alerts; status source of truth for web orders. |
| `order_items` | Storefront line items | Read via parent order. |
| `order_status_history` | Order transitions | Read for notification/review. |
| `admin_users` | Storefront admin accounts | Do **not** reuse as POS staff identity. |
| `delivery_zones` | Delivery configuration | Not POS-critical. |
| `storage.objects` | Product media | Public read only for intended buckets; writes only through authorised policy. |

### 2.2 POS-owned (observed in the old POS)

| Table | Observed purpose | Notes / risks to verify |
| --- | --- | --- |
| `pos_users` | Local PIN staff roster | Old table may contain `pin_hash`; `anon` SELECT is a critical leak if still present. New app uses Supabase Auth; link via `auth_user_id`. |
| `pos_sales` | Sale headers | May exist with old RPC-written shape. Treat as historical/legacy, not the new write target until reconciled. |
| `pos_sale_items` | Sale lines | Same. |
| `pos_returns` | Return headers | Same. |
| `pos_return_items` | Return lines | Same. |

### 2.3 Legacy RPCs observed (must not be trusted by POS 2.0)

`pos_record_sale`, `pos_create_product`, `pos_record_return`,
`pos_apply_sale_stock`, `pos_daily_totals`, `decrement_stock`.

Known issues in the old contract: caller-supplied identity, no payload hash,
`anon` grants, missing authorisation, replay double-decrement, no stock ledger.
Phase 2 must either revoke/retire these or prove they are unused by the
storefront before adding `*_v2` replacements.

## 3. Target POS tables

Names are proposals. Phase 2 either adopts existing names compatibly or chooses
new ones to avoid colliding with live data.

### 3.1 Staff identity

`pos_users` (extend; do not expose hashes)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | Internal staff id. |
| `auth_user_id` | uuid UNIQUE NULL | Supabase Auth user. Required for new accounts. |
| `staff_code` | text UNIQUE | Human-friendly login identifier. |
| `name` | text NOT NULL | Display name / receipt. |
| `role` | text NOT NULL | `manager` \| `cashier` (check constraint). |
| `active` | boolean NOT NULL DEFAULT true | Disabled staff cannot act. |
| `pin_verifier` / `pin_hash` | text NULL | Legacy only; no client-readable access; new auth has no browser hash. |
| `failed_attempts` | integer NOT NULL DEFAULT 0 | Server-side rate limiting. |
| `locked_until` | timestamptz NULL | Temporary lockout. |
| `last_login_at` | timestamptz NULL | Audit. |
| `deactivated_at` | timestamptz NULL | Lifecycle. |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

**Phase 2 implementation note.** `auth_user_id` was added by the auth-link
migration with a partial unique index and an `ON DELETE SET NULL` FK to
`auth.users`. `scripts/link-pos-users.mjs` (run as `pnpm auth:link` after
`supabase db reset`) creates one confirmed Auth user per active unlinked row
using `[slugged-name]@pedigree.local`, a random discarded password and
`user_metadata.pos_staff_id`, then writes the returned id back to the row. It is
idempotent and refuses non-local URLs unless `--yes` is passed.

The PIN login Route Handler still reads `pos_users` with the server-only service
client, verifies the bcrypt `pin_hash` and fails closed if `auth_user_id` is
null. It never exposes hashes to the browser. The RLS migration revokes `anon`
and excludes `pin_hash` from the authenticated column grant. Moving PIN
verification into a `SECURITY DEFINER` RPC remains a live-schema review item.

Local provisioning:

```bash
supabase db reset
pnpm auth:link --dry-run
pnpm auth:link
```

### 3.2 Sales

`pos_sales`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | Server id. |
| `client_uuid` | uuid UNIQUE NOT NULL | Idempotency key. |
| `receipt_number` | text UNIQUE NOT NULL | Human receipt lookup. |
| `cashier_id` | uuid NOT NULL | FK `pos_users`, derived from session. |
| `subtotal_kes` | integer NOT NULL | >= 0. |
| `discount_kes` | integer NOT NULL DEFAULT 0 | >= 0. |
| `total_kes` | integer NOT NULL | >= 0, server computed. |
| `payment_method` | text NOT NULL | `cash` \| `mpesa` \| `card_external`. |
| `payment_status` | text NOT NULL | `pending` \| `paid` \| `failed` \| `requires_reconciliation`. |
| `amount_tendered_kes` | integer NULL | Cash only. |
| `change_due_kes` | integer NULL | Cash only. |
| `payment_reference` | text NULL | Verified provider reference only. |
| `status` | text NOT NULL DEFAULT 'recorded' | `recorded` \| `voided` \| `requires_reconciliation`. |
| `origin` | text NOT NULL DEFAULT 'pos' | `pos` \| `legacy_import`. |
| `created_at` | timestamptz NOT NULL DEFAULT now() | Business time. |
| `server_received_at` | timestamptz NOT NULL DEFAULT now() | Commit time. |
| `voided_at`, `void_reason`, `voided_by` | timestamptz/text/uuid NULL | Auditable void. |

`pos_sale_items`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `sale_id` | uuid NOT NULL | FK, cascade on delete only if sale void policy allows. |
| `product_id` | uuid NOT NULL | FK `products`; snapshot name below. |
| `product_name` | text NOT NULL | Immutable snapshot. |
| `category` | text NULL | Reporting snapshot. |
| `quantity` | integer NOT NULL | > 0. |
| `unit_price_kes` | integer NOT NULL | Server price at commit. |
| `line_discount_kes` | integer NOT NULL DEFAULT 0 | >= 0. |
| `line_total_kes` | integer NOT NULL | Server computed. |

Aggregate duplicate products in the RPC; use a partial unique index on
`(sale_id, product_id)` where `product_id IS NOT NULL`.

### 3.3 Returns

`pos_returns`: `id`, `client_uuid` UNIQUE, `original_sale_id`, `cashier_id`,
`manager_id`, `refund_kes` (>= 0), `refund_method`, `refund_reference`,
`refund_status` (`recorded` \| `paid` \| `failed` \| `reconciled`),
`reason`, `approval_method`, `approved_at`, `created_at`, `origin`.

`pos_return_items`: `id`, `return_id`, `product_id`, `product_name`, `category`,
`quantity` (> 0), `unit_price_kes`. Unique per `(return_id, product_id)`.

### 3.4 Stock ledger

`stock_movements` (append-only)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `product_id` | uuid NOT NULL | |
| `delta` | integer NOT NULL | Non-zero signed change. |
| `quantity_after` | integer NOT NULL | Snapshot at write. |
| `reason` | text NOT NULL | `sale`, `return`, `opening`, `receiving`, `correction`, `write_off`. |
| `reference_type` / `reference_id` | text/uuid NULL | Sale, return, adjustment. |
| `actor_staff_id` | uuid NOT NULL | From session. |
| `client_uuid` | uuid UNIQUE NULL | Idempotency for offline-free retries. |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

### 3.5 Payments

`payment_intents`

`id`, `sale_client_uuid`, `method`, `amount_kes` (integer > 0), `status`
(`created` \| `pending` \| `successful` \| `failed` \| `cancelled` \| `timed_out` \|
`requires_reconciliation`), `provider`, `provider_request_id`, `idempotency_key`
UNIQUE, `phone` (normalised, minimal retention), `created_at`, `updated_at`,
`expires_at`.

`payment_events` (durable inbox)

`id`, `intent_id`, `provider`, `provider_event_id` UNIQUE, `event_type`,
`payload` (redacted where possible), `verified`, `applied_at`, `received_at`,
`error`.

### 3.6 Audit and currency

`audit_log`: `id`, `actor_staff_id`, `action`, `entity`, `entity_id`,
`before` jsonb, `after` jsonb, `created_at`.

`exchange_rates` (append-only history; current rate = latest active row):
`id`, `usd_to_kes` numeric(12,4) or integer scaled value (**decide in Phase 2**),
`effective_from`, `created_by`, `created_at`, `note`. The manager UI reads the
latest; sales keep their own KES amounts and never join back to this table.

### 3.7 Optional / later

Till sessions, cash movements, receipt email outbox, device enrolment and
offline assertions are **deferred**. Do not add device/offline tables unless the
online-only design explicitly needs them.

## 4. RLS target

`anon` gets **no** access to staff, sales, returns, payments, stock movements or
audit tables. Public storefront reads stay with the storefront's own policies.

| Table | anon | authenticated staff | manager |
| --- | --- | --- | --- |
| `products` | no direct POS access | SELECT active (safe columns; no barcode) | SELECT all + write via RPC |
| `product_colors` / `product_images` | storefront policy only | SELECT | SELECT |
| `pos_users` | none | SELECT own safe columns | SELECT all safe columns; writes via RPC |
| `pos_sales` / `pos_sale_items` | none | SELECT own sales (or policy-defined scope) | SELECT all |
| `pos_returns` / `pos_return_items` | none | SELECT own initiated | SELECT all; writes via RPC |
| `stock_movements` | none | none | SELECT |
| `payment_intents` / `payment_events` | none | SELECT own attempt status (narrow view) | SELECT all; writes via server only |
| `exchange_rates` | none | SELECT current | SELECT all; write via RPC |
| `audit_log` | none | none | SELECT |

Barcode privacy: do not expose `products.barcode` in a public projection. Either
revoke column-level SELECT and provide a staff-only view/RPC, or keep POS
identifiers in a separate staff-only table. Hiding the field in the UI is not
enough.

### 4.1 `pos_users` implementation (local)

- RLS is enabled. The legacy `"pos_users are readable by the till"` policy is
  dropped and `anon` has no table privileges.
- `authenticated` receives column-level SELECT only on
  `id, name, role, active, auth_user_id, created_at`. `pin_hash` is not granted,
  and direct INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER grants are revoked.
- Policies:
  - `Staff can read their own POS row` — `auth.uid() = auth_user_id`.
  - `Managers can read the POS roster` — `public.pos_is_manager()`.
- `pos_is_manager()` is `SECURITY DEFINER`, `stable`, pinned to
  `search_path = public, pg_temp`, executable only by `authenticated`, and checks
  an active manager row.
- Verified locally: anon SELECT `401`, cashier safe columns return only the
  cashier row, cashier `pin_hash` `403`, manager roster returns all rows.

The service-role key still reads `pin_hash` for login verification and is never
sent to the browser. A future migration should move verification into a
`SECURITY DEFINER` RPC with its own rate-limit and audit fields.

## 5. RPC contracts

All RPCs are `SECURITY DEFINER`, `SET search_path = public, pg_temp`, revoke
`PUBLIC`, grant only the intended role, derive caller identity from
`auth.uid()`, and write audit rows where required.

### 5.1 Sales

```
pos_record_sale_v2(
  p_client_uuid uuid,
  p_payment_method text,
  p_items jsonb,              -- [{ product_id, quantity, requested_unit_price? }]
  p_discount_kes integer,     -- manager-authorised only; else 0
  p_amount_tendered_kes integer,
  p_payment_reference text,   -- card only; M-Pesa via intent
  p_created_at timestamptz
) returns jsonb                -- { sale_id, receipt_number, totals, lines, payment_status }
```

Behaviour:

1. Resolve staff from `auth.uid()`; reject inactive/unknown.
2. If `client_uuid` exists, return the existing sale (no side effects).
3. Validate item shape, positive integer quantities, active products.
4. Recompute unit prices, discounts and totals server-side. Ignore client
   prices except to detect a mismatch and return a repricing error.
5. Lock product rows, verify stock, write `stock_movements` and update the
   projection atomically.
6. Insert sale and lines; aggregate duplicate product ids.
7. Payment status: cash is `paid` on commit; card is `paid` only with a recorded
   reference per policy; M-Pesa never through this RPC.
8. Return the canonical receipt payload.

### 5.2 Returns

```
pos_record_return_v2(
  p_client_uuid uuid,
  p_original_sale_id uuid,
  p_items jsonb,              -- [{ product_id, quantity }]
  p_refund_method text,
  p_refund_reference text,
  p_reason text
) returns jsonb
```

- Manager-only; approving manager derived from session.
- `SELECT ... FOR UPDATE` the original sale.
- Reject products not on the sale; cap cumulative returned quantity.
- Refund is computed server-side, not accepted from the client.
- Restore stock via ledger; mark `refund_status` honestly.

### 5.3 Manager RPCs

| RPC | Purpose |
| --- | --- |
| `pos_adjust_stock(p_client_uuid, p_product_id, p_delta, p_reason, p_reference)` | Authorised stock adjustment with ledger row. |
| `pos_set_exchange_rate(p_usd_to_kes, p_note)` | Manager-only; appends history + audit. |
| `pos_create_product_v2(...)` | Manager-only catalogue creation compatible with storefront columns. |
| `pos_update_product_v2(...)` | Manager-only edit; no silent stock overwrite. |
| `pos_set_staff_role(...)` / `pos_set_staff_active(...)` | Manager-only; audit; cannot demote the last manager. |
| `pos_daily_totals(p_day date)` | Manager-only, EAT boundaries, confirmed sales minus refunds. |

### 5.4 Payment server paths

STK initiation and callback handling are Route Handlers, not client RPCs. They
use the service-role client **only** after verifying staff session or provider
callback authenticity. Suggested RPCs:

- `pos_create_payment_intent(...)` — idempotent attempt creation.
- `pos_apply_mpesa_event(...)` — dedupe provider event, verify amount/context,
  transition intent, finalise sale exactly once.

## 6. Migration rules and compatibility checklist

Before any shared migration:

1. Record the live migration history (read-only).
2. Generate live TypeScript types and diff against this contract.
3. Identify every storefront dependency on `products`, colours, images, orders,
   settings and RLS.
4. Confirm the old POS is retired or unaffected.
5. Write additive SQL with explicit `IF EXISTS`/`IF NOT EXISTS` where sensible.
6. Include RLS policies and grants in the same migration as the table.
7. Add pgTAP tests for: anon denial, cashier denial, manager success, disabled
   staff denial, idempotent replay, concurrent oversell, over-return.
8. Apply to a disposable/local Supabase first; test POS and storefront flows.
9. Only then coordinate production application with explicit authorisation.

### Known compatibility risks

- Old `pos_users.pin_hash` and `anon` SELECT policies may still be live.
- Old `pos_record_sale` may be granted to `anon` and trust caller identity.
- `products` may lack `updated_at`; storefront stock RPCs may depend on it.
- `orders` policies may allow public insert with arbitrary totals.
- Barcodes may be readable through a public `products` projection.
- USD price overrides may exist in the storefront; do not remove them until
  migration is agreed.

## 7. Type generation

Still pending live project confirmation. Once the shared schema is inspected:

```bash
supabase gen types typescript --project-id <id> > lib/supabase/types.ts
```

Commit the generated file. Do not hand-write table types that will drift from
the shared project. Update `lib/supabase/client.ts` and `server.ts` to use the
generated `Database` generic at that point.

For local-only work, `supabase gen types typescript --local` can produce a
candidate file, but it describes the seed schema, not the shared production
schema, so it must not be treated as the live contract.

## Phase 3 contract observation — 2026-11-16

Read-only inspection of the running local database found no public sale
functions. The repository contains `pos_create_sale` in migration
`20261111150000_pos_sales.sql`, but this is not evidence that it is installed.
The existing sale action still targets that function; its input validation is
now cash-only. The old `pos_record_sale` takes caller identity and monetary
amounts and is not a compatible substitute for server pricing. Clarification
is pending; no migrations or database schema changes were made in Phase 3.

## Phase 3 cash RPC — 2026-11-16

Migration: `20261116100000_pos_sale_rpc.sql` (follows the existing catalogue
and sales-table baselines; local development only so far).

```sql
pos_record_sale(
  p_client_uuid uuid,
  p_cashier_id uuid,
  p_total_kes integer,
  p_payment_method text,
  p_amount_tendered integer,
  p_items jsonb
) returns boolean
```

Each item is `{product_id: uuid, color_id: uuid, quantity: integer,
price_at_sale: integer}`. Colour is required because this catalogue tracks
inventory by colour. Checkout allocates product quantities across loaded
colours, and the RPC verifies stock again under locks. Quantities are 1–1000;
cart length is 1–100. All monetary inputs and persisted amounts are integer KES.

The caller must have a session linked to an active `pos_users` row, and
`p_cashier_id` must equal that row's id. The Server Action derives this id
from `requireStaff()`. `SECURITY DEFINER` uses an empty `search_path`, qualified
tables, revoked PUBLIC/anon execute, and authenticated-only execute. The old
`pos_create_sale` entry point is revoked from authenticated callers.

Only `cash` is accepted. The RPC locks products and colours in UUID order,
recalculates discounted unit prices from `products.base_price` and
`products.discount_percent` using PostgreSQL numeric rounding, and rejects any
claimed unit price or total mismatch. Additional cart discounts are outside
this six-parameter contract. Tendered cash must cover the verified total.

The header claims its UUID with `ON CONFLICT (client_uuid) DO NOTHING` before
stock writes. A duplicate owned by the caller returns `false` immediately;
a UUID belonging to another staff member is denied. New commits return `true`.
The header, lines, stock movements, product projection and audit event commit
or roll back together. A replay does not validate changed catalogue prices
against a historical sale; it returns the existing outcome without modifying it.
The Server Action fetches the stored receipt after either boolean outcome.

`products.stock_quantity` is an aggregate projection of colour stock. A delta
trigger maintains it on colour insert/update/delete, including the existing
restock path. Checkout decrements colour stock; this trigger decrements product
stock in the same transaction. This avoids two independent stock authorities.
The normal application roles cannot overwrite stock directly.

`pos_sale_audit` has one immutable application-written `cash_sale_recorded`
event per sale, with sale id, actor and timestamp. RLS restricts reads to active
managers and denies direct application writes. Stock ledger reasons include the
sale's client UUID. The migration has not been reviewed against or applied to
the live storefront database.

### Explicit variant payload clarification — 2026-11-16

The cash RPC signature and item JSON are unchanged. The UI now supplies the
cashier-selected `color_id` for each cart line, rather than allocating a product
quantity across colour rows. Product + colour identify a cart line. The server
still authorizes the caller and validates price, membership and stock. Local
E2E verification confirmed the selected colour is persisted and only its stock
is decremented; no migration was needed.

## Phase 4 management contract — 2026-11-17

Local migrations: `20261116200000_pos_management.sql` and
`20261116201000_pos_product_edit_history.sql`. Live compatibility review is
still required before any shared project application.

| RPC | Contract |
| --- | --- |
| `pos_manager_create_product(uuid,jsonb)` | Manager only. JSON has name, description, category, basePrice, barcode and colors `{name,hex,stockQuantity,imageUrl}`. Returns product UUID; records opening stock and audit atomically. |
| `pos_manager_adjust_stock(uuid,uuid,uuid,integer,text)` | Manager only. Request UUID, product, colour, signed delta and required reason. Returns resulting colour stock; ledger carries `reference_uuid`. Same request is applied once. |
| `pos_manager_create_cashier(uuid,uuid,text,text)` | Manager only. Request id equals pre-provisioned Auth id; name and PIN are validated. Server checks active PIN uniqueness, stores bcrypt, fixes role to cashier, and audits without PIN data. Returns staff UUID. |
| `pos_manager_dashboard()` | Manager-only paid sales aggregates and recent sales for the Nairobi calendar day, low-stock count/list, and exchange-rate display value. |
| `pos_manager_update_product(...)` | Existing signature retained; updates existing colour ids, preserves stock and history, rejects removing stocked/sold colours, and audits edits. |

All new public RPCs are SECURITY DEFINER with an empty search_path, qualified
object references, PUBLIC/anon execute revoked and explicit active-manager
checks. `pos_claim_management_request` is internal and has no application-role
execute grant. `pos_management_events` has manager-only read RLS and denies
direct application writes; it stores UUID, actor, kind, payload, result and time.
Payload mismatch or another actor reusing a UUID is rejected. Staff payloads
contain only the name/Auth id, never the PIN or verifier.

Auth users are provisioned server-side with a deterministic id, internal email,
confirmed identity and managed marker. SQL checks that anchor before linking
`pos_users`. The service role remains server-only and is used only for Auth
provisioning/compensation here; privileged product/stock/staff writes use the
session-authorized RPCs. Known enrollment DB errors compensate a newly created
Auth user; uncertain outcomes keep it to allow safe retry. Normal authenticated
roles still cannot read PIN hashes. Existing local sales were preserved while
applying the migrations.


## Phase 7 — Local M-Pesa contract

Applied locally only: `20261117080000_pos_mpesa.sql` and
`20261117081000_mpesa_snapshot_finalization.sql`. No reset or live migration.

`pos_mpesa_sales` stores UUID drafts with actor, canonical integer amount,
canonical item snapshots and lifecycle status. `pos_mpesa_transactions.sale_id`
references this draft (the eventual paid sale uses the same UUID), allowing
attempts to exist without a falsely paid `pos_sales` row. Attempts include
provider ids, phone, integer amount, status, receipt, timestamps, hashed callback
capability, minimal callback evidence, manual code and reconciliation reason.
Checkout/receipt ids are unique; only one unresolved/success attempt per draft
is allowed. Authenticated column grants expose only safe polling fields, with
owner/manager RLS. Phone and callback evidence are not browser-readable.

Authenticated active staff can prepare their own server-priced draft, cancel
it only when no payment remains unresolved, and save an unverified manual code.
Service-only RPCs claim dispatch, attach provider ids, persist authenticated
callback evidence, mark dispatch failures and atomically apply verified results.
All privileged functions pin search_path, revoke PUBLIC execution and check
identity/role. Direct application writes are denied.

`pos_record_sale` retains the cash interface and permits M-Pesa only to the
service role with a matching verified draft/attempt. `pos_apply_mpesa_callback`
requires durable success callback evidence and independent provider result 0,
then invokes it within a transaction and verifies the committed sale. Replays
return the existing result. The canonical draft snapshots govern captured
prices; stock is validated at finalization. Failures preserve evidence with
`reconciliation` status rather than create a paid sale. Manual codes never
constitute payment verification. SQL authorization/atomicity tests cover this
contract alongside the cash and management suites.


## Phase 5 — Exchange-rate settings

On the POS settings layout, migration `20261117100000_pos_exchange_rate.sql` adds the numeric
`exchange_rate_kes_to_usd` (despite its name, KES per 1 USD), default 130, positive
and at most 100000. The existing primary key plus fixed `exchange_rate` key check
allow one row. The migration creates that row on compatible tables. App roles
cannot insert/delete; only active managers can update the rate column. Public
read access remains for storefront display. Anonymous write access is removed.
A protected trigger synchronizes `value.kes_per_usd` for legacy readers and stamps
actor/time. Manager Server Action performs a direct session-authorized UPDATE.
The migration skips incompatible storefront schemas and tables with additional
settings. The dashboard falls back to 130 on the alternate schema. The POS
exchange-rate settings screen requires the compatible schema.


## Phase 5 — Realtime web-order notifications

`20261117110000_pos_realtime_orders.sql` adds `public.orders` to the existing
`supabase_realtime` publication if absent. When orders is present, the
publication must already exist. When public.orders is absent, it
prints a notice and skips publication, grants and policies so POS-only resets
can complete. The local baseline does not provision storefront orders. If that
schema is introduced later, rerun this migration SQL after review to enable
notifications, then run its SQL test. A missing publication still fails when
orders exists.
No migration was applied during this task; shared/live rollout still needs review.
`order_items` is not published because header notifications need no line items.

Verified against the read-only storefront source: `lib/orders-api.ts` inserts
`id`, `order_number`, `customer_name`, integer KES `total`, and
`status = pending_payment`; migration 006 documents the current status constraint.
The listener also accepts historical `pending` and compatible `awaiting_payment`
INSERTs without changing the shared status constraint. It never treats arrival as
proof of payment or writes inventory, payments or orders.

The migration enables RLS, grants authenticated SELECT, and adds active
cashier/manager SELECT access to incoming orders. A restrictive policy blocks
order reads for disabled linked POS identities even when legacy storefront
policies grant broad authenticated reads. Non-POS storefront policies are
preserved, including existing broad authenticated policies; this is not a full
storefront-policy hardening migration. Anonymous access is not added. Review all
existing shared policies and grants before rollout.

`GET /api/realtime/orders-token` validates the server-side staff session and
returns only the existing short-lived user access JWT and expiry with private,
no-store headers. Refresh tokens and service credentials stay server-side. The
browser uses an isolated, nonpersistent Supabase client and passes the JWT to
Realtime `setAuth`; this does make the normal staff access JWT available to
JavaScript, so the policies on all shared tables remain the authorization boundary.
The hook refreshes through the server at most every minute, removes its channel
when authentication fails, and cleans up channels/timers/audio on unmount.
Disabled staff reads are blocked by RLS independently of that refresh interval.


## Phase 4 expanded — Product publishing and stock adjustment audit

`20261117120000_pos_product_publishing.sql` replaces the existing atomic product
creation RPC to accept an optional JSON boolean `isWebsitePublished` (default
false for existing callers), persist it as `products.is_website_published`, and
retain it in the idempotency payload. A changed flag cannot reuse a committed
creation UUID. The update RPC continues to write that same products column,
preserve colour ids and leave historical sale prices and stock unchanged.
Product stock remains authoritative on `product_colors.stock_quantity`, with
product-level projections maintained by existing triggers where present. Do not
write an independent product stock total from the form.

The new `pos_stock_adjustments` table records manager opening stock and signed
adjustments, including ledger movement id, management request UUID, product,
colour, actor, delta, before/after quantities, reason and timestamp. A private
SECURITY DEFINER trigger with pinned empty search_path inserts each audit row
inside the stock movement transaction. It only mirrors movements belonging to
manager product_created/stock_adjusted requests; ordinary sales stay in the
existing ledger. The unique movement reference prevents duplicate audit rows;
existing UUID handling prevents duplicate stock changes. New opening stock
movements now carry the creation UUID. Existing historical movements are retained
in stock_movements and are not retroactively copied into the new table.

RLS permits active managers to SELECT audit rows and denies direct application
INSERT/UPDATE/DELETE. Foreign keys preserve the linked movement, management
request, product, colour and actor. Product editing refuses to remove a colour
with new adjustment history, alongside the existing stock/sale-history guards.

`upsertProduct` is the validated manager-only Server Action used by both forms;
it routes creation/edit payloads to the existing authorized RPCs. `adjustStock`
is the manager-only action for signed, reasoned, UUID-based adjustments. POS and
manager paths are revalidated after changes. Metadata always writes shared
products; variants/images and inventory use their existing related tables.

Storefront compatibility was inspected read-only in its source: public catalogue
queries use an anonymous client and require colours with positive stock; the POS
catalogue migration's RLS additionally requires active + is_website_published.
The database flag controls eligibility immediately on fresh Supabase reads.
However, storefront pages are prerendered and its own product actions invalidate
its cache. POS revalidatePath cannot invalidate another application's cache; no
cross-app revalidation endpoint exists in the inspected storefront. Instant
updates to already-cached storefront pages require coordinated storefront cache
invalidation or request-time reads. This work does not claim that integration is
verified or installed. No shared/live migration was applied.


## Returns and refunds

`20261117130000_pos_returns.sql` adds manager-readable, immutable application
records:

- `pos_returns`: generated return id, unique client UUID, original sale FK,
  processed_by staff FK and name snapshot, integer KES refund_amount, reason,
  canonical request_items and timestamptz created_at.
- `pos_return_items`: return FK, original sale_item FK, product/colour FKs,
  historical name snapshots, positive quantity and integer KES refund_amount.
  Each sold line occurs at most once per return. FKs restrict deletion of
  historical sales, products, colours, staff and return headers.

All table writes are revoked from PUBLIC/anon/authenticated; active managers can
SELECT through RLS. `pos_process_return(uuid,uuid,text,jsonb)` is SECURITY DEFINER
with an empty pinned search_path, revoked PUBLIC/anon execution, and explicit
active-manager authorization before any read/replay/write. Its external payload
contains only client UUID, original sale ID, reason, and original sale-item IDs
with quantities. Actor, products, colours, prices and refund totals are derived
inside PostgreSQL. Only paid sales qualify. Missing historical colours are
rejected rather than inferred. Inactive products may be restocked using their
original colour.

The RPC serializes a client UUID with a transaction advisory lock, then locks the
original sale to serialize competing partial returns. Replays must match actor,
sale, trimmed reason and a sorted canonical item payload. A replay returns its
existing ID before changing stock. Duplicate/foreign item IDs, invalid quantities,
over-returns, unpaid sales, changed replay payloads and aggregate refunds beyond
the original paid total are refused. Product and colour rows are locked in the
same stable order as other stock RPCs.

The private `pos_returnable_items(uuid)` helper allocates the original paid total
across sale lines using differences of floored cumulative proportions of stored
line_total. For each line it allocates its budget across cumulative returned
quantities using integer differences. This includes sale-level discounts,
prevents rounding over-refunds and makes a full return sum exactly to the original
paid total, including zero-price lines. Current catalogue prices are irrelevant.
`pos_return_sale_details(uuid)` is a manager-authorized read RPC using that same
helper for the return UI. No raw allocation helper execution is granted to clients.

One transaction inserts the header/items, increments exact colour stock and
writes positive stock_movements with actor, reason, timestamp and return ID as
reference_uuid. The required existing pos_project_product_stock trigger updates
products.stock_quantity in that transaction. The migration rejects a missing or
non-normal-enabled projection trigger; directly incrementing products as well
would count the return twice. Any validation/write failure rolls everything back.
Returns do not enter the manager-adjustment audit mirror; stock_movements remains
the common inventory ledger.

Historical sales/payment statuses/amounts are left unchanged. A return records a
manual refund obligation against the original sale; it does not call a payment
provider or assert that money was transferred. Existing sales dashboards remain
gross sales, with refund history provided separately in the returns screen.
No net-sales reporting change or automatic provider reversal is included.
No migration was applied to shared/live data during this task.


## Cashier return requests with Manager PIN approval

`20261117140000_pos_return_pin_approval.sql` adds optional requested_by to returns
and a private, RLS-enabled pos_return_pin_attempts table keyed by requesting
cashier. Only a service-role RPC can perform PIN approval. The action requires
an authenticated active staff session, supplies that verified staff ID and sends
PIN/request via FormData so Next development action-argument diagnostics do not
print the PIN. Browser callers cannot execute the service approval bridge or
choose another cashier identity.

`pos_process_return_with_pin` verifies the server role and active cashier, then
checks a four-digit PIN against active staff bcrypt hashes inside PostgreSQL,
requiring exactly one matching active manager. Ambiguous legacy duplicate PINs
are rejected.
Five failed attempts impose a durable 30-second per-cashier lockout. Wrong PINs
return normally so the lockout update commits. Unlinked/disabled managers cannot
approve. PINs and hashes are not stored in return payloads or returned to browsers.
For an accepted PIN, the bridge temporarily scopes auth.uid to the linked manager,
calls existing pos_process_return (retaining its quantity/refund/idempotency and
stock checks), records requested_by, and restores both JWT sub and full claims on
success/error. It does not mint an Auth session or change cashier cookies.
Processed_by remains the approving manager. Manager workspace returns retain
their manager-session authorization; till returns require the manager PIN.

`pos_staff_return_sale_details` authorizes active staff to read the minimal
historical quantities/budgets needed by the approval form; it does not grant
cashiers direct SELECT on refund audit tables. Read lookup is separate from PIN
approval; refund writes still require manager authorization. An uncertain action
response freezes the request UUID/payload and requires another manager PIN for
same-request recovery, even if the remaining quantity has since become zero.

## Premium digital receipts and quotations

`20261117141000_pos_digital_documents.sql` adds pos_quotations and
pos_receipt_documents. Both keep client UUID, independent random share_token,
creator, serving-staff name, customer name/normalized international phone,
integer totals, immutable line snapshots and creation time. Receipt documents
also reference the original paid sale and sale_created_at; the template displays
the original sale date while row created_at audits preparation time.

All direct application writes and anonymous SELECT are revoked. Active creators
and managers may read their documents under RLS. `pos_create_quotation` validates
items, derives prices/discounts and product/colour/image snapshots from the shared
catalogue, and caps integer totals. It never changes/reserves stock, records a
sale or marks payment. Its retry UUID binds customer, owner and canonical cart;
replay preserves quoted prices after later catalogue changes. `pos_create_receipt_document`
requires a paid sale and derives historical items/totals/serving cashier from it;
current colour swatches/images enrich and are snapshotted at preparation time.
Client-submitted prices and receipt totals are never used. Both RPCs pin empty
search_path, authorize active staff and revoke PUBLIC/anonymous execution.

The authenticated actions use FormData with Zod-validated customer/cart payloads.
The public route `/documents/[kind]/[id]/[token]` verifies document ID and a separate
unguessable UUID capability using a server-only admin read. Knowing a receipt or
quote ID alone grants no access; anonymous table enumeration stays denied. A link
holder may view the customer name and document contents without staff login.
Customer phone is retained for staff sharing, not rendered on the public template.
Links currently remain valid until revoked by changing the stored token; no
customer-account requirement, automatic expiry or token-rotation UI is included.

Shared pages are request-rendered with no-index/no-referrer/no-store headers.
Next request logging ignores document paths; production reverse proxy/access
logging must also redact capability URLs. Product image requests omit referrers.
WhatsApp opens a wa.me URL with the normalized phone and URL-encoded receipt or
quote message plus the capability link. Cashiers review/send in WhatsApp; opening
it is not evidence of delivery.

The email endpoint now accepts kind/documentId/to/requestUuid, replacing the old
client-supplied sale payload contract. It rechecks staff authorization/RLS and
renders escaped premium inline HTML from the stored document, with a capability
link. Resend handles transmission with a provider idempotency key. Requires
RESEND_API_KEY and a verified RESEND_FROM_EMAIL; POS_PUBLIC_URL controls the
public origin for email links/images. Provider acceptance is reported separately
from delivery. No real email or WhatsApp message was sent during implementation.
Both migrations remain unapplied locally and to shared/live data.


## Flutterwave card payments

`20261117150000_pos_flutterwave.sql` adds pos_card_payments: UUID, unique tx_ref,
original staff, integer expected amount, immutable server-priced cart/name
snapshots, status, unique provider transaction ID, integer paid_amount, safe
failure code and timestamps. It contains no card number, CVV, expiry, card token
or raw provider/customer payload. RLS permits active owners/managers to read;
application direct writes and anonymous reads are revoked.

`pos_prepare_card_sale` authenticates staff, validates current catalogue prices
and stock, stores the priced snapshot and binds the reference POS-CARD-[UUID].
Retries compare the same cart/total and cannot reprice a started attempt. There
is at most one open card draft per staff member. `pos_mark_card_opened` records
pending before the hosted modal is invoked. Only an unstarted prepared draft can
be cancelled by its active owner; cancellation retry is idempotent. Closed modal,
missing callback and provider timeout are not proof that funds were not captured.

Card preparation/opening, cash commit and M-Pesa initiation use a shared staff
transaction lock and durable conflict guards. Cash and M-Pesa cannot start while
that staff member has a prepared/open/verified/reconciliation card payment.
Card opening refuses unresolved M-Pesa attempts. The cashiers' active card draft
is recovered from Supabase after reload; browser storage is not financial state.

POST /api/flutterwave/verify requires an active staff session and same-origin
request, validates transaction_id/tx_ref/expected_amount and authorizes the draft
owner or a manager before contacting Flutterwave. Expected amount is read from
that server draft; a lower client amount is rejected. The route checks provider
status=successful, exact transaction ID/reference, currency=KES, payment_type=card
and whole-KES amount >= stored expected amount. Overpayment is retained as paid_amount
for reconciliation; sale/return values stay at the expected order total. Fractional
KES values are rejected at the boundary. No client callback status is trusted.

FLW_SECRET_KEY is server-only. Verification uses the fixed HTTPS v3 transaction
endpoint with bearer authorization, no caching, timeout and redirects disabled.
When callbacks are lost, the same route accepts an omitted transaction_id and
queries Flutterwave's verify_by_reference endpoint for the same stored tx_ref.
Responses are stripped to numeric provider ID, reference and amount before any
persisted evidence is written. Card metadata/tokens/provider payloads are neither
logged nor saved. NEXT_PUBLIC_FLW_PUBLIC_KEY alone is included in the browser.

Only service_role may call pos_finalize_card. It binds verified provider evidence
uniquely and calls the existing pos_record_sale RPC with method card. That RPC
now requires the matching service-only verified draft for card commits, uses its
frozen historical snapshot, and writes the paid sale, sale lines, stock ledger
and card_sale_recorded audit atomically. Cash and M-Pesa branches retain their
existing pricing/verification contracts. A matching retry returns the original
sale without a second stock decrement; another provider ID cannot replace saved
evidence. A captured payment encountering missing stock/catalogue keeps its
verified reference/amount in reconciliation while nested sale/stock writes roll
back. After manager stock resolution, same-reference verification can finalize it.

The inline modal is card-only and collects card details within Flutterwave,
while the POS collects email/phone for the hosted customer configuration.
After server success, the existing receipt opens and browser printing is
requested; printer errors cannot undo a sale. Webhook auto-reconciliation,
automatic refunds/overpayment payouts and a force-cash/force-cancel override for
opened uncertain attempts are not included. Unresolved/failed/closed sessions
require provider/manager reconciliation, not assumptions from onclose. No real
keys were inserted or provider charge triggered; migration remains unapplied.

Implementation follows Flutterwave's primary documentation:
[Inline modal](https://developer.flutterwave.com/docs/collections-inflow/inline),
[verification checks](https://developer.flutterwave.com/docs/transaction-verification),
[verify endpoint](https://developer.flutterwave.com/api/transactions/verify-transaction)
and [reference recovery](https://developer.flutterwave.com/api/transactions/verify-transaction-with-tx-ref).


## C2B manual-till callback observations

`POST /api/mpesa/c2b/confirmation` validates a bounded notification and immediately
returns ResultCode 0 / ResultDesc Accepted after logging a redacted observation.
The log includes an event name, stable transaction fingerprint, decimal amount
text and verified=false. It excludes the original transaction ID, phone, customer
name, account reference, tokens and full provider body. Invalid JSON/fields return
HTTP 400 without echoing their contents. The paired validation endpoint accepts
well-formed C2B notifications but writes no sale/payment state.

These public endpoints do not claim authenticated provider evidence. They do not
mark sales paid, change stock, allocate manual deposits to a receipt or replace
STK verification. Observations are application logs, not a durable payment ledger;
manual C2B matching/provider verification remains a separate accounting step.
Decimal text is preserved without converting notification amounts to database
money. No new table, grant or RPC is introduced for this logging-only task.

`scripts/register-mpesa-urls.ts` loads .env.local without printing credentials,
requests OAuth and posts the official C2B registration fields to Daraja. Uses
MPESA_C2B_SHORTCODE when set, otherwise MPESA_SHORTCODE. For an API callback base,
ConfirmationURL is base + /c2b/confirmation and ValidationURL is base +
/c2b/validation. Existing /api/mpesa/callback STK URLs are normalized to their
/api/mpesa base for registration; the environment value and STK behavior are not
changed. Bare origins also resolve to the application's /api/mpesa routes.
Unsupported paths, query/token URLs and embedded credentials are rejected.

The script defaults to Sandbox; production registration requires the explicit
--production switch. `pnpm mpesa:register-urls --dry-run` shows the registration
payload without making a network call. `pnpm mpesa:register-urls` performs the
Sandbox registration. OAuth/provider status must be accepted before success is
reported; terminal errors omit provider bodies and secrets. The real Sandbox
attempt in this task failed on DNS before OAuth; no URLs were registered and
credential validity/Ngrok delivery remain unverified.


C2B registration now explicitly preloads .env.local via the package command's
Node --env-file flag. Direct script runs also resolve that file from the project
root relative to the script; missing/unreadable files fail instead of being
silently ignored. Consumer credentials are trimmed and validated before building
the OAuth header. Standard Node environment precedence is retained: existing
shell variables take precedence over values loaded from the file.

Manual registration diagnostics now show the exact OAuth URL, four-character
consumer-key prefix, lengths and SHA-256 header fingerprint. Authorization is
redacted in output while the complete Basic header is sent privately to OAuth.
No full credential, Base64 credential pair or provider token enters these logs.
