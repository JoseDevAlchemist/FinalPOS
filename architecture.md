# Architecture — Pedigree POS 2.0

**Status:** Phase 4 requested management flows and colour images tested locally; live rollout pending.
**Last updated:** 2026-11-17
**Related:** `AGENTS.md`, `database-contract.md`, `progress.md`

## 1. System shape

Pedigree POS 2.0 is a single Next.js application deployed to a Node-capable host.
It talks to the **shared** Pedigree Supabase project, which also serves the
Pedigree Leather storefront.

```
┌──────────────────────────┐        ┌──────────────────────────┐
│  POS browser (staff)     │        │ Storefront (customers)   │
│  React 19 / Next.js 16   │        │ Next.js                  │
│  ┌────────────────────┐  │        └───────────┬──────────────┘
│  │ Server Components  │  │                    │
│  │ Server Actions     │  │                    │
│  └─────────┬──────────┘  │                    │
└────────────┼─────────────┘                    │
             │ HTTPS (anon key + auth cookie)   │
             ▼                                  ▼
┌─────────────────────────────────────────────────────────────┐
│ Supabase                                                     │
│  Auth (staff sessions)                                       │
│  Postgres + RLS + SECURITY DEFINER RPCs                      │
│  Storage (product images)                                    │
│  Realtime (inventory / order notifications, where useful)    │
└───────────────┬─────────────────────────────────────────────┘
                │ server-to-server, secrets server-side only
                ▼
┌─────────────────────────────────────────────────────────────┐
│ Safaricom Daraja (STK Push + callback)                       │
│ Browser print / Web Serial (client-local, optional)          │
└─────────────────────────────────────────────────────────────┘
```

### Trust boundaries

| Boundary | Trust |
| --- | --- |
| Browser UI | Untrusted. Can be modified with DevTools. |
| Supabase anon key | Public. RLS decides everything. |
| Supabase Auth session | The staff identity claim, verified server-side. |
| Route Handlers / Server Actions | Trusted execution, but still validate all input. |
| `SECURITY DEFINER` RPCs | Trusted only if `search_path` is pinned, `PUBLIC` revoked, caller authorised inside the function. |
| Service-role key | Server-only. Never in the browser bundle, never in a log. |
| M-Pesa callback | Untrusted until signature/shape/amount/reference checks pass. |
| Hardware (VFD, printer) | Optional and side-effect-free for money. Failure never blocks a sale. |

## 2. Online-first model

The previous POS treated Dexie/IndexedDB as an operational database and synced
later. This application does not.

- Supabase Postgres is the only source of truth for products, stock, sales,
  payments and staff.
- A sale is complete when the server RPC commits it. A local cart is UI state.
- If Supabase is unreachable, checkout is disabled and the UI says so. No sale is
  queued locally.
- A browser refresh restores history from the server, not from local storage.
- Client-generated UUIDs provide idempotency, not offline durability.

Permitted browser storage: non-financial preferences only (for example the last
used VFD device id and UI layout). Never money, stock, roles or PIN hashes.

## 3. Authentication and authorization

- **PIN sign-in:** a 4-digit PIN identifies an active `pos_users` row. No PIN
  hash is ever shipped to the browser. The Route Handler
  (`app/api/auth/login/route.ts`) reads active staff with the server-only
  service client, verifies the bcrypt `pin_hash`, applies a per-client lockout,
  and never trusts a role supplied by the caller.
- **Identity:** the matched staff row must have an `auth_user_id`. The server
  mints a Supabase Auth session for that user (admin link exchange plus
  `verifyOtp`), and `@supabase/ssr` writes the HTTP-only session cookies.
  `pos_users.auth_user_id` is added by migration and populated by
  `pnpm auth:link`, which creates a confirmed Auth user per active staff row.
  Rows without a link fail closed with “staff account is not ready for sign-in”.
  The link and RLS have been tested locally, not against the shared project.
- **Session:** `@supabase/ssr` cookie session, refreshed by the Next.js Proxy in
  `proxy.ts`. Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`;
  the behaviour is the same.
- **Authorization:** enforced in three layers:
  1. Proxy redirects unauthenticated requests for `/pos` and `/manager`.
  2. Each protected page calls `requireStaff()` or `requireManager()`; layouts
     also re-read the session and staff row, but layout guards alone do not stop
     child segments rendering.
  3. RLS is enabled on `pos_users`: `anon` has no access, authenticated staff can
     read only safe columns of their own row, and active managers can read the
     roster. `pin_hash` is outside the authenticated grant.
- The client-provided role is never evidence. The role comes from `pos_users`
  joined by `auth_user_id`; a disabled or unknown staff row wins over a valid
  token and is signed out.
- Sign-out clears the Supabase Auth cookies and redirects to `/login`.
- The service-role key is server-only and is never placed in a `NEXT_PUBLIC_`
  variable, a browser payload or a log.

Detailed policies live in `database-contract.md`.

## 4. Data flows

### 4.1 Catalogue read

1. Server Component calls `createClient()` from `lib/supabase/server.ts`.
2. RLS returns only products the staff member may see. Public storefront
   projections must not expose POS-only barcodes.
3. Product cards render server-side; filtering/paging uses URL search params.
4. Realtime or revalidation refreshes stock after sales.

### 4.2 Sale commit (cash / card reference)

```
Cashier UI
  │ validate cart shape locally (Zod) — UX only
  ▼
Server Action / Route Handler
  │ require authenticated active staff
  │ validate payload (Zod)
  ▼
RPC pos_record_sale_v2(p_client_uuid, p_items, p_payment, ...)
  │ 1. authorise staff (auth.uid -> staff row, active)
  │ 2. lock/verify products, prices, discounts server-side
  │ 3. verify stock availability under concurrency
  │ 4. insert sale + lines (idempotent on client_uuid)
  │ 5. decrement stock via ledger movements
  │ 6. insert audit row
  │ 7. return canonical receipt payload
  ▼
UI renders server-confirmed sale; printing is best-effort
```

Rules:

- Duplicate `client_uuid` returns the original result, never a second sale.
- Price, discount, tax and total are recomputed by the RPC.
- Stock is written as movements; a projection may be updated atomically.
- The UI never shows “paid” before the RPC/payment verification returns.

### 4.3 M-Pesa STK Push

```
POS -> POST /api/payments/mpesa/stk  (authenticated staff)
  1. validate + normalise phone
  2. create/reuse payment_intent (idempotency key)
  3. call Daraja STK Push (secrets server-side)
  4. return pending status + intent id
Customer approves on phone
Daraja -> POST /api/payments/mpesa/callback
  1. persist raw event in payment_events (dedupe provider id)
  2. verify amount, shortcode, account/reference, result code
  3. transition intent: pending -> successful | failed | cancelled | timed_out
  4. finalise sale exactly once (idempotent)
  5. audit
POS polls or subscribes to intent/sale status
```

- A callback is not trusted until validated and correlated to the intent.
- Replayed or duplicate callbacks are no-ops after the first application.
- Pending/stale intents surface as **requires reconciliation**, never as paid.
- Cash, external card reference and verified M-Pesa payments are distinguishable.

### 4.4 Returns

Manager initiates a return against an original sale. The RPC locks the sale,
checks line membership and cumulative returnable quantity, records the approving
manager, refund method/amount/reason, and restores stock via ledger movements.
Electronic refunds are only marked paid when the provider confirms.

### 4.5 Exchange rate

On the POS settings layout, an active manager can update the exchange-rate
column. The database records the actor and timestamp. When the storefront uses
a different settings layout, the migration leaves its settings intact and the
manager dashboard uses its default rate. USD display prices are derived from
integer KES base prices with documented rounding. Completed sales retain their
historical KES amounts.

### 4.6 Website orders

The POS subscribes to the storefront's actual order/payment status model. Only
confirmed orders notify staff; drafts are not “paid”. Notifications are
non-blocking and deduplicated.

## 5. Hardware interfaces

Hardware is a local, optional enhancement layer. None of it is in the commit
path for money.

### 5.1 Customer VFD (Web Serial)

- Client-only module (`lib/hardware/customer-display.ts`, Phase 6).
- Singleton external store read with `useSyncExternalStore` (pattern proven in
  the old POS `lib/customer-display.ts`).
- States: `disconnected | connecting | connected`; connect, reconnect, stored
  vendor/product id, unsupported-browser handling.
- Messages are two lines of 20 characters on the known device; content is
  padded/truncated and kept within that budget.
- Idle: `WELCOME TO / PEDIGREE`. Sale: latest item and total. Checkout: payable
  amount, cash received/change, M-Pesa pending. Success is only shown after
  server confirmation.
- A simulator is provided for development; write errors never block a sale.

### 5.2 Barcode scanner

- Keyboard-wedge input captured by a scanner-aware input/global listener.
- Resolves against authorised POS identifiers only.
- Unknown barcode produces recoverable feedback, not a crash.
- Repeated scans increment quantity within the allowed stock.

### 5.3 Thermal printer

- Browser print with isolated `.print-root` content and 80mm `@page` rules
  (already in `app/globals.css`).
- Receipt is rendered from the server-confirmed sale payload, never from the
  local cart alone.
- `window.print()` is best-effort. Driver/paper-size limitations are documented,
  not “fixed” by pretending.

## 6. Application boundaries

```
app/            routing, layouts, server entry points
components/     presentation only (no business rules)
lib/<domain>/   pure rules, validation, DB access helpers
lib/supabase/   browser and server clients
supabase/       migrations and DB tests
types/          generated and shared domain types
```

- Server Components by default; `"use client"` only at interactive leaves.
- Server Actions for own-UI mutations. Route Handlers for webhooks/callbacks and
  long-running provider calls.
- Domain modules expose intent-named functions (`recordSale`, `adjustStock`),
  not table-shaped CRUD.
- Validation lives in `lib/validation/` and is reused by both client UX and
  server enforcement; the server is the one that matters.

## 7. Connectivity and failure model

| Condition | Behaviour |
| --- | --- |
| Online | Normal operation; server-confirmed writes. |
| Supabase unreachable | Banner “POS currently offline”; checkout disabled; cart preserved in memory only. |
| Auth session expired | Redirect to sign-in; no privileged action proceeds. |
| Commit timeout | Retry with the same idempotency key; reconcile before retrying a payment. |
| Duplicate checkout click | Same client UUID; server returns the existing sale. |
| Last-item race | RPC rejects the loser with a clear out-of-stock result. |
| Printer/VFD failure | Toast/log only; sale stays committed. |
| M-Pesa delayed callback | Intent stays pending, then timed out/requires reconciliation. |

## 8. Deployment assumptions

- Node runtime for server actions/route handlers that hold secrets.
- Environment variables per `.env.example`; no secret in `NEXT_PUBLIC_*`.
- Migrations are reviewed and applied deliberately, never auto-run against the
  live shared project.
- The storefront must be regression-tested after any shared-schema migration.

## Phase 3 implementation note — 2026-11-16

The terminal reads the catalogue through the authenticated server client, filters
locally, and keeps only an in-memory cart. Scanner reads use loaded products;
checkout validates again through a staff-authorized Server Action and the database
RPC. Cash is the only terminal payment option in this phase. Checkout retries
retain their UUID and payload; receipts use the canonical returned sale and a
body-level print portal. No offline queue is used.

The existing action calls `pos_create_sale`; the requested legacy
`pos_record_sale` is incompatible with this server-pricing contract. RPC choice
awaits clarification. The existing local database currently has no public sale
functions installed, so the full commit/stock/print flow is unverified. No schema
changes were made to resolve this.

## Phase 3 cash commit implementation — 2026-11-16

The previous RPC-choice note is superseded by the authorized cash migration.
The terminal sends a UUID, claimed unit prices/total, tendered cash and product/
colour quantities to `createSaleAction`. The action validates with Zod, derives
the cashier from the server session and calls `pos_record_sale`. SQL verifies
identity, current prices and stock, claims the UUID before inventory writes,
and atomically stores the sale, historical lines, ledger and audit event.
Product stock is a trigger-maintained aggregate of colour stock. Both projections
roll back with the transaction on failure.

The boolean RPC result distinguishes a new commit from a replay. In either case,
the action queries persisted sale/line values for the receipt, then revalidates
the terminal catalogue. The client preserves a UUID across uncertain outcomes;
known transaction rejections release it for corrected input. There are no card,
M-Pesa or extra cart-discount controls in the Phase 3 checkout.

## Explicit colour selection — 2026-11-16

Product-card radio groups hold their selected colour in the terminal parent.
Cart lines are identified by product and colour ids and preserve that selection
independently of later card changes. The cart builder validates each selected
colour's availability and emits exactly that colour id and quantity; it no
longer distributes a product quantity across colours. The existing cash RPC
continues to verify the product/colour relationship, price and stock atomically.
The card preview/stock, cart labels and historical receipt identify the variant.

## Phase 4 management — 2026-11-17

Protected manager pages use authenticated reads/RPCs. The overview uses a
manager-only aggregate RPC with Nairobi day boundaries. Product creation and
stock adjustment claim UUIDs in `pos_management_events`, verify manager status
inside SQL, and atomically commit catalogue/stock/ledger/audit data. The stock
projection trigger continues to keep product and colour quantities consistent.
Editing preserves historical colour ids and sale amounts.

Cashier provisioning spans Auth and Postgres: a manager-authenticated Server
Action creates a confirmed, marker-tagged Auth user with the request UUID, then
calls the staff RPC to store a unique active bcrypt PIN verifier and fixed
cashier role. Deterministic ids support retries; definite DB rollback allows
compensation, while uncertain outcomes retain the Auth identity for recovery.
Neither PINs nor hashes are sent in roster data or stored in audit payloads.
FormData avoids development action-argument PIN logging in this Next.js build.

The terminal uses a client image leaf for object-cover photos and load-failure
fallback. Only the selected colour's image is shown; a missing photo keeps its
colour swatch rather than implying another variant's appearance. Manager and
POS navigation use route-local loading boundaries around uncached data.


## Phase 7 — M-Pesa trust boundary

Checkout prepares a server-priced `pos_mpesa_sales` draft, then claims a UUID
payment attempt before contacting Daraja. A draft is not a paid sale and does
not reserve/decrement stock. Dispatch retries return the same attempt rather
than send another STK request; uncertain network outcomes stay unresolved.

The callback carries a per-attempt HMAC capability. The server checks its hash,
request ids, amount, phone and receipt, saves minimal callback evidence, and
independently queries Daraja with server credentials. Both matching callback
success and provider-query success are required before the service-only
`pos_apply_mpesa_callback` calls `pos_record_sale`. Sale, lines, stock movements,
audit and payment success commit atomically. Captured draft prices remain
immutable if the catalogue changes while the customer enters their PIN.

RLS-limited status polling returns a receipt only after committed server
success. A 60-second screen timeout is not a payment decline. Manual codes are
saved as unverified, and unresolved attempts block another charge or cash
switch. If payment succeeds but stock cannot be committed, durable evidence
remains in reconciliation; stock can be restored through audited management
and finalization retried safely. No offline queue is involved.

Secrets stay in server environment variables. Callback URLs contain a secret
capability: Next request logging excludes callback routes, and any future
reverse proxy/access logging must also redact query strings. Local tests use a
localhost-only mock override, refused in production or against remote Supabase.
Real Daraja sandbox/tunnel verification remains a separate step.


Phase 5 settings uses `requireManager` on both page and Server Action. The action
validates with Zod and directly updates the singleton numeric rate through the
session Supabase client; manager RLS and column grants enforce the same rule in
Postgres. JSON compatibility is maintained by a database trigger. No historical
KES sale amounts change when the display exchange rate changes.


Phase 6 hardware is an optional client-side projection of the cart. The display
singleton exposes cached external-store snapshots and serializes frame writes
with a latest-wins pending slot. Disconnection retains only the latest display
text in memory. No stock/payment state depends on serial I/O. The Connect action
loads the browser-only package dynamically; server rendering uses a disconnected
snapshot. The existing global scanner ignores editable fields and dialogs and
uses the normal stock-checked cart path; server checkout remains authoritative.


## Realtime web-order alerts (Phase 5)

The protected till and manager shells mount one `WebOrderNotifications` client
leaf per active layout. `useRealtimeOrders` authenticates through the no-store
staff token bridge, then listens for incoming-order INSERTs using Postgres
Changes with the existing user JWT and orders RLS. The browser never stores the
JWT persistently or receives refresh credentials. Order payloads pass a Zod
schema before formatting; a bounded in-memory id set suppresses duplicate events
within a mounted listener. Cleanup removes channels, timers and audio resources.

New order toasts remain until manually dismissed and cannot be evicted by cart
toasts. A scrollable toast stack handles bursts. Web Audio provides a quiet chime
once a user gesture enables audio; audio failure never blocks checkout. A status
line shows connection failure while Supabase retries the websocket and the hook
retries authentication. No offline queue or financial writes are involved.

Postgres Changes does not replay orders created during disconnection or before
subscription. These are arrival alerts, not a durable pending-orders inbox or an
accurate pending count. The optional manager count badge is not implemented.
Production acceptance must verify RLS, websocket delivery, staff disablement,
reconnection and browser audio against the reviewed shared storefront schema.


## Expanded manager catalogue management

Both create/edit forms call `upsertProduct` → requireManager + Zod → existing
manager-authorized Postgres RPC → shared products, product_colors and
product_images. Creation supports draft/published immediately; editing preserves
variant identities and historical amounts. Colour preset checkboxes provide
multi-selection alongside the existing custom-colour editor. Initial quantities
are per colour; subsequent changes use the stock adjustment modal from the list
or edit page, with signed quantity and required reason.

`adjustStock` → authorized transactional RPC → colour stock + stock_movements
→ private audit trigger → pos_stock_adjustments. Audit and stock commit/roll back
together. The audit is manager-readable only and cannot be written directly by
browser roles. Adjustment history prevents deletion of the linked variant.

The listing displays Published/Draft. Drafts remain available in the till;
website visibility uses the shared products flag and public-read policies.
Fresh database visibility is the supported sync boundary here. The separate
storefront's prerendered page cache still needs a coordinated invalidation path
for immediate rendered updates; POS-local revalidation cannot refresh that cache.


## Manager returns and manual refunds

`/manager/returns` requiresManager, searches paid receipts by their existing
8-hex-character displayed number (or full sale UUID), and offers up to 50 recent
or matching sales. Ambiguous short numbers produce selectable results rather
than silently choosing a sale. The selected sale is loaded through a guarded
read RPC with original items, refundable budgets and already-returned quantities.
Manager navigation exposes Returns on desktop and mobile.

`ReturnForm` → processReturn Server Action → requireManager + Zod →
pos_process_return → original-sale lock → return/refund rows + variant stock +
product-stock projection + stock movement ledger. PostgreSQL owns final amounts,
quantities and atomicity. The client only previews the server-supplied historical
budget using exact integer math. A synchronous busy guard and stable request UUID
protect duplicate submissions. Ambiguous network/receipt-read failures freeze the
payload for Retry same return; a replay recovers the original persisted receipt.
Only a confirmed response lets the manager start another partial return.

The saved result displays a success toast and optional printable 80mm Return
Receipt. Printing is independent of the committed refund. The modal uses the
existing print-root rules, keyboard focus/trapping and shared EAT formatting.
Latest return history (20 rows, scoped to the selected sale when present) permits
reprinting/recovery after reload. Cashiers use the normal manager handoff; no PIN
reauthorization shortcut or new cashier-side privileges were introduced.

Refunds are recorded for manual settlement. Original sale records remain
immutable and dashboards retain their existing gross-sales meaning. Physical
repayment, automatic M-Pesa reversals, refund settlement reconciliation and net
sales reporting are outside this feature.


## Cashier approval and premium digital documents

Till Return → receipt lookup → select sold quantities/reason → manager enters PIN
→ FormData Server Action with requireStaff → service-only, rate-limited SQL PIN
bridge → existing manager-authorized atomic return RPC. Cashier identity and
manager approval are separately audited. Manager PINs stay server-side and the
cashier session remains unchanged. The return dialog prevents closing while a
write is pending/uncertain and allows same-request recovery with manager approval.

Till Create Quote → customer name/phone → server-priced immutable quotation RPC
→ premium DocumentTemplate. Sale success → customer name/phone → paid-sale
snapshot RPC → same premium template as a receipt. Both are responsive full-page
HTML using the existing semantic tokens, brand logo, item images/swatches,
customer, EAT date, original cashier, totals and Karibu Tena footer. They do not
use receipt-paper, 80mm widths or thermal print-root CSS; digital print styles
have their own named A4 page. Thermal printing remains a separate sale option.
Quote creation leaves the cart, sales and stock unchanged and is clearly labelled
as a quotation; it cannot masquerade as a paid receipt.

A document's random capability URL opens a read-only server-rendered view without
staff login. It is intentionally shareable with a customer but not enumerable
through anonymous database access. No-index/no-referrer/no-store headers and
referrer-free external images reduce unintended exposure. Access logs outside
Next must redact these links. The UI explains that anyone with a link can view it.

Send to WhatsApp opens a prefilled wa.me link; staff complete delivery there.
Send via Email calls the existing Resend-backed endpoint using a saved document
ID rather than browser-supplied sale amounts. Inline email styles mirror brand
tokens because email clients do not load application Tailwind CSS. Recipient
validation, escaped HTML and provider idempotency are part of that path. Email
configuration/provider acceptance and actual message delivery require separate
runtime acceptance. No automatic messaging occurs merely on checkout or quote
creation.


## Flutterwave card checkout

Card tab → load hosted v3 script → staff-authorized server pricing/snapshot →
record opened attempt → FlutterwaveCheckout card-only modal → callback ID →
authenticated verification route → independent Flutterwave HTTPS verification →
service-only finalizer → existing pos_record_sale → sale/stock/audit → receipt
and optional hardware printing. The client public key is the only Flutterwave
credential in the bundle. Raw card entry remains within Flutterwave's iframe.

The native checkout dialog temporarily closes while Flutterwave's hosted overlay
is visible so the browser top layer cannot cover or disable the payment window.
The native dialog resumes for verification/result recovery. Processing Card...
blocks repeated initiation; duplicate or late callback completions cannot clear
a later cart. The cart remains locked across unknown outcomes and saved drafts
are restored from the server on remount. Even an empty restored cart can open
Resolve payment to recover its persisted checkout. Cash/M-Pesa also have durable
SQL guards, so a browser reload cannot bypass the financial lock.

Server preparation binds a unique reference and original integer price snapshot;
expected_amount in the verification request is a consistency check, never the
source of price authority. Only verified successful KES/card evidence can finalize.
A stock race preserves evidence for reconciliation without a partial sale. Check
Card Status re-verifies by reference and recovers a committed receipt after a lost
response. Closing/declining the hosted window does not automatically unlock an
attempt that may still complete asynchronously. Only unstarted drafts have a
safe cancellation path; manager/provider reconciliation is required otherwise.

Flutterwave status webhooks and unattended reconciliation are outside this request.
Existing manual returns can record refunds against a verified card sale, but do
not initiate a provider reversal. Digital documents continue to use immutable paid
sale snapshots. No card transaction or actual printer was exercised in this sandbox.

POS-only local resets treat storefront orders as optional: the Realtime orders
migration skips publication and orders RLS/grants/policies with a notice when
public.orders is missing. If the reviewed storefront schema is added later,
rerun that setup SQL to enable notifications. The POS does not create a substitute
orders table.


## Manual Till C2B notification endpoints

C2B confirmation → bounded Zod validation → redacted unverified log → immediate
Accepted response. There is no database/provider request on this path, so payment
notification acknowledgement does not wait for STK polling or reconciliation.
The validation endpoint exists because URL registration includes both callback
addresses. Neither public endpoint turns an unverified request into a paid sale.
Next development request logging ignores C2B callback paths; explicit confirmation
logs contain only a transaction fingerprint/amount text/verified=false marker.

The standalone TypeScript registration command loads the existing Sandbox
configuration, obtains OAuth and registers HTTPS confirmation/validation URLs.
It understands the existing full STK callback URL and leaves it untouched while
deriving C2B routes from the API base. --dry-run is read-only; production is an
explicit opt-in. A successful registration and real public callback delivery
still need verification outside the network/container-restricted session.


Registration configuration loading is explicit at CLI startup (--env-file) and
script-relative for direct execution. File-loading errors and missing/blank
credentials fail before OAuth; existing shell environment precedence is retained.

### Manager catalogue and rate compatibility

The manager product form reads the exchange rate and active storefront categories
on the server. Per-colour image uploads use the manager-authorized Server Action
and `product-images` Storage bucket. The catalogue RPC persists the public URLs
alongside barcode, category, variants and stock movements. The USD figure is a
preview calculated from the shared rate. The till receives only a boolean for
Flutterwave availability.

### Catalogue image staging

Create and edit share a per-colour file picker, drop area and angle editor.
Device-local previews use revocable object URLs. On save, the manager-only
upload action validates MIME, file size and decodable content before transferring
the original bytes to Storage. Content-derived object keys let an interrupted
upload retry without overwriting a live photo. The form reuses successful
uploads and stops before any catalogue mutation if a photo fails. An uncertain
catalogue response keeps the exact payload and request ID for confirmation.

Storage and PostgreSQL commit separately. Abandoned saves may leave an
unused Storage object. Photo removal edits the database reference and preserves
the object for any other reference. The catalogue RPC commits the product,
colour IDs, photo links, publication state and opening ledger entries atomically.

### Catalogue save boundaries

The catalogue RPC checks the active manager directly and verifies the actor,
kind and payload recorded by the private request-claim helper. New photo links
must match the RPC's trusted Storage origin and an existing object in the
product's directory. Existing legacy links can remain on their saved variant.
An edit retires a colour by deletion only when it has zero stock and no known
history or foreign-key references beyond photo metadata.
