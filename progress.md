# Progress — Pedigree POS 2.0

Chronological log of phases, work completed, checks run and known gaps.
Statuses: **Not started**, **In progress**, **Implemented**, **Tested**,
**Blocked**, **Deferred**.

## Current phase

**M-Pesa C2B acknowledgements and Sandbox URL registration — IMPLEMENTED AND BUILD-VERIFIED; reset/registration blocked by local runtime/network.**

Realtime setup already skips missing storefront orders. C2B confirmation and
validation routes plus the registration script are implemented. Sandbox reset
and actual URL registration were attempted, but Podman runtime access and DNS
prevent completion. No real payment was initiated.

## Phase overview

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundation, docs, design tokens, Supabase clients | Implemented |
| 1 | Authentication, staff identity, role guards | Implemented |
| 2 | Database integration, auth-user link, RLS | Implemented locally; live review pending |
| 3 | Sales terminal, catalogue, cart, cash checkout, receipts | Complete and tested locally |
| 4 | Manager dashboard, products, inventory and staff; returns planned | Product management accepted; returns implemented and build-verified; runtime acceptance pending |
| 5 | Currency, storefront integration, order notifications | Exchange-rate settings complete locally; web-order alerts implemented; live verification pending |
| 6 | Hardware: VFD, scanner, thermal printer, simulators | Requested VFD/scanner integration complete in code; physical acceptance pending |
| 7 | M-Pesa STK Push and Flutterwave card payments | M-Pesa backend verified locally; card implemented/build-verified with mock tests; provider/database acceptance pending |
| 8 | Production hardening, E2E, performance, deployment review | Not started |

## 2026-11-11 — Phase 2 work log

### Completed

- Added `supabase/migrations/20261111130000_pos_users_base.sql`, a baseline
  `pos_users` table for environments provisioned from this repo. It is a no-op
  where the shared table already exists and does not attempt to repair drift.
- Added `supabase/migrations/20261111130100_pos_users_auth_link.sql`:
  `auth_user_id uuid` referencing `auth.users(id) ON DELETE SET NULL`, a partial
  unique index, and an explanatory column comment.
- Added `supabase/migrations/20261111130200_pos_users_rls.sql`: enables RLS,
  removes the legacy “readable by the till” policy, revokes `anon`, grants
  `authenticated` only safe columns (never `pin_hash`), and adds self-select and
  active-manager-select policies backed by `pos_is_manager()`.
- Added `scripts/link-pos-users.mjs` / `pnpm auth:link`. It creates confirmed
  Auth users with `[slugged-name]@pedigree.local`, random discarded passwords,
  `user_metadata.pos_staff_id`, links the row, rolls back an Auth user if the row
  update fails, is idempotent, supports `--dry-run`, `--only` and `--domain`,
  and refuses non-local URLs unless `--yes` is passed. Passwords are never
  logged.
- Added `supabase/seed.sql` with throwaway local staff (cashier `1234`, manager
  `4826`) and `supabase/config.toml` for reproducible local development.
- Hardened the protected pages themselves: `app/manager/page.tsx` calls
  `requireManager()` and `app/pos/page.tsx` calls `requireStaff()`, so a cashier
  no longer receives manager page content even though Next.js streams the
  redirect as a 200.
- Created a local Supabase stack (Postgres, Auth, REST, Kong) through Podman’s
  Docker-compatible API because Docker is not installed. Applied all migrations,
  ran the seed, ran `pnpm auth:link`, and exercised the app against it.

### Verification (local Supabase, production Next.js server)

| Check | Result |
| --- | --- |
| `supabase db reset` | Passed; three migrations applied and seed loaded. |
| `pnpm auth:link --dry-run` | Passed; showed two intended links, no writes. |
| `pnpm auth:link` | Passed; created and linked two Auth users. |
| `pnpm auth:link` (second run) | Passed; both rows skipped as already linked. |
| Cashier `1234` login | `200`, HttpOnly `SameSite=Lax` session cookie set, `/pos` rendered Brian Otieno/cashier. |
| Cashier `/manager` | Redirect payload to `/pos`; no manager page content in the response. |
| Manager `4826` login | `200`, session cookie set, `/manager` rendered Grace Wanjiru. |
| Manager `/pos` | `200`, manager navigation present. |
| Sign-out | `303` to `/login`; subsequent `/pos` returned `307` to login. |
| Wrong PIN | `401 invalid_pin`, no session. |
| Unlinked staff | `403 staff_not_linked`. |
| Inactive staff | `401 invalid_pin` (not matched). |
| Five failed attempts | Fifth and sixth returned `429` with `Retry-After: 30`. |
| RLS anon select | `401` permission denied. |
| RLS cashier safe columns | `200`; only own row. |
| RLS cashier `pin_hash` | `403` permission denied. |
| RLS manager roster | `200`; both staff rows. |
| `pnpm build` | Passed; same route shape as Phase 1. |

### Decisions

- **Link, do not duplicate, staff.** Existing PIN rows keep their `id`; the new
  Auth user is an identity anchor, not a second roster.
- **No password login.** Generated passwords are random, discarded and never
  used. PIN verification remains the only staff sign-in.
- **Fail closed.** A null `auth_user_id`, inactive row or missing Auth user never
  yields a session.
- **RLS now protects the roster.** The legacy `anon` SELECT policy is dropped and
  `pin_hash` is outside the authenticated column grant. The old POS, which relied
  on reading hashes with `anon`, will stop reading the roster after this
  migration; this is intentional for the replacement app but must be coordinated
  before touching the live project.
- **Page guards, not only layout guards.** Layouts do not control whether child
  segments render; each protected page and future Server Action must call
  `requireStaff()`/`requireManager()` itself.

### Not verified / blockers for live

- The shared/live Supabase project has not been inspected. Migration history,
  existing `pos_users` columns and storefront dependencies are unknown from this
  repo. **Do not apply the migrations to live without the checklist in
  `database-contract.md`.**
- No Auth users have been provisioned in the live project.
- The old POS and storefront have not been run against the new RLS grants.
- No pgTAP suite or automated E2E test exists yet; the checks above are a manual
  integration run, not a committed test suite.
- Type generation from the live project is still pending.
- The in-memory lockout remains per-process and the client IP key is spoofable
  unless a trusted proxy sets it. Durable per-staff rate limiting is Phase 8.
- A bare 4-digit PIN is not unique by itself; the first matching active row wins.
  Enrolment should enforce unique active PINs or add a staff code.

## 2026-11-11 — Phase 1 work log

### Completed

- Added a server-only Supabase admin client (`lib/supabase/admin.ts`) for the
  narrow operations that cannot run as `anon`: reading staff PIN records and
  minting a staff session. The service-role key is server-only and added to
  `.env.example` with a warning.
- Added PIN validation and normalisation (`lib/validation/auth.ts`,
  `lib/auth/pin.ts`) and bcrypt verification against `pos_users.pin_hash`
  (`lib/auth/verify-pin.ts`). Hashes never leave the server.
- Added an in-memory per-client lockout after five failed PIN attempts
  (`lib/auth/rate-limit.ts`). It is intentionally documented as per-process;
  durable rate limiting belongs in Phase 8.
- Added `POST /api/auth/login`: validates the payload, enforces the lockout,
  verifies the PIN, requires a linked `auth_user_id`, mints a Supabase Auth
  session through an admin link exchange plus `verifyOtp`, and lets
  `@supabase/ssr` write the HTTP-only cookies.
- Added `GET|POST /api/auth/logout`: revokes the Supabase Auth session, clears
  the cookies and redirects to `/login`.
- Added the 50/50 login page (`app/login/page.tsx`): leather brand panel on the
  left, PIN keypad on the right, with the mobile lockup above the keypad.
- Added accessible toast notifications for invalid PIN, network/server errors,
  lockout and “Welcome back” (`components/ui/toast.tsx`).
- Added `proxy.ts` (Next.js 16 replaced `middleware.ts` with `proxy.ts`) to
  refresh the Supabase session and protect `/pos` and `/manager`. Unknown
  sessions are redirected to `/login` with a `next` hint.
- Added role guards in `app/pos/layout.tsx` and `app/manager/layout.tsx`.
  `requireStaff()` loads the staff row by `auth_user_id` and signs out unknown or
  inactive staff. `requireManager()` sends cashiers to `/pos`.
- Added placeholder till and manager screens that establish the protected route
  shape without starting Phase 3 or Phase 4 work.
- Updated `architecture.md`, `database-contract.md`, `features.md` and
  `testing.md` to describe the Phase 1 auth contract and its current limit.

### Decisions

- **Next.js 16 proxy naming.** The requested `middleware.ts` was implemented as
  `proxy.ts`, the current file convention. The function is `proxy` and the
  matcher excludes API and static assets.
- **PIN verification is server-side only.** The old POS shipped bcrypt hashes to
  the browser. This app does not: the route handler is the only verifier.
- **Supabase Auth remains the identity source.** A correct PIN resolves a staff
  row, then the server mints a Supabase Auth session for that row's
  `auth_user_id`. This keeps future RLS policies keyed to `auth.uid()`.
- **Fail closed when the account is not linked.** Existing `pos_users` rows have
  `pin_hash` but no `auth_user_id`. Those logins return a clear “account not
  ready” result until Phase 2 links them; they never fall back to a weaker
  client-trusted session.
- **Role is read from the database.** The layout queries `pos_users` by
  `auth_user_id`; a client-supplied role is never trusted.

### Verification

- `pnpm lint` — passed (ESLint, no findings).
- `pnpm exec tsc --noEmit` — passed.
- `pnpm build` — passed. Routes: `/` static redirect, `/login` static,
  `/pos` and `/manager` partial-prerendered behind Suspense guards,
  `/api/auth/login` and `/api/auth/logout` dynamic, Proxy registered.
- Route-protection smoke test (production server, no database): `GET /pos`
  returned `307` to `/login?next=%2Fpos`, `GET /login` returned `200`, and an
  empty login payload returned `400`. This proves the guard and validation, not
  PIN verification.

### Not verified / known gaps at the time

- PIN login, session minting and sign-out were not exercised against a real
  Supabase instance until Phase 2. Resolved locally in the Phase 2 log.
- `pos_users.auth_user_id` and the Auth-user linkage were Phase 2 work. Resolved
  by the Phase 2 migrations and `pnpm auth:link` (live still pending).
- The service-role read of `pos_users` remains for PIN verification. The `anon`
  exposure was removed by the Phase 2 RLS migration; moving PIN verification into
  a `SECURITY DEFINER` RPC is still pending live-schema review.
- The in-memory lockout remains per-process. Durable rate limiting is Phase 8.
- A bare 4-digit PIN is still not unique; enrolment must enforce uniqueness or a
  staff code.
- Manager-only Server Actions and RPC checks start in Phase 4, on top of
  `requireManager()`.
- No pgTAP/E2E suite is committed yet.

## 2026-11-11 — Phase 0 work log

### Completed

- Inspected the blank Next.js 16.4.6 project (React 19.3, Tailwind v4,
  TypeScript strict, pnpm).
- Read the reference POS design tokens (`PedigreePOS/app/globals.css`) and VFD
  service (`PedigreePOS/lib/customer-display.ts`). No offline architecture was
  copied.
- Installed foundation dependencies: `@supabase/ssr`, `@supabase/supabase-js`,
  `lucide-react`, `framer-motion`, `clsx`, `zod`.
- Replaced `app/globals.css` with the Pedigree design system: warm ivory/cream,
  espresso brown, muted gold, status tokens, warm shadows, serif/sans pairing,
  receipt print rules.
- Updated `app/layout.tsx` to load Manrope and Cormorant Garamond (tokens now
  resolve) and to declare the POS metadata/viewport.
- Created `lib/supabase/client.ts` (browser, `@supabase/ssr`, memoised) and
  `lib/supabase/server.ts` (async `cookies()`, per-request client).
- Created `.env.example` with the shared project URL/key and server-only Daraja
  placeholders; adjusted `.gitignore` so the template is tracked while real
  `.env*` files stay ignored.
- Wrote `AGENTS.md`, `architecture.md`, `database-contract.md`,
  `projectguideline.md`, `features.md`, `testing.md` and this file.
- Established folder conventions (`components/*`, `lib/<domain>`, `supabase/*`,
  `types/`, `tests/`, `docs/`).

### Decisions

- Online-first only. No Dexie, IndexedDB queues, `sync_queue`, service worker
  outbox or browser PIN hashes.
- Supabase Auth is the staff identity source. The old local `pos_users` roster is
  reference only until Phase 2 verifies the live schema.
- Supabase clients are intentionally untyped until Phase 2 generates types from
  the shared project; guessing a schema would hide drift.
- The old POS and its migrations are read-only. No live schema change has been
  made.

### Verification

- `pnpm lint` — passed (ESLint, no output).
- `pnpm exec tsc --noEmit` — passed.
- `pnpm build` — passed (Next.js 16.4.6, Turbopack; static `/` and `/_not-found`).
- No runtime/manual verification: there were no pages, auth flow or hardware
  integrations yet.

## Next steps

1. Review the Phase 2 migrations against the live shared project before applying
   anything. Record live migration history, diff the live `pos_users` columns,
   confirm the old POS is retired or accepts the loss of `anon` roster reads, and
   run the compatibility checklist in `database-contract.md`.
2. Generate TypeScript types from the confirmed project and adopt them in the
   Supabase clients.
3. Add committed pgTAP tests for the staff RLS policies and an E2E test for the
   PIN login → `/pos` → `/manager` → sign-out flow.
4. Phase 3: sales terminal after the live schema and auth boundaries are signed
   off.

## 2026-11-16 — Phase 3 sales terminal

- Reused the server-fetched Supabase catalogue and Pedigree product cards; added category chips alongside name/barcode search.
- Matched scanner input against the loaded catalogue using the hook ported from the read-only old POS. Unknown codes show an error toast; Enter also works in the search input.
- Kept cart state in memory with stock quantity limits and subtotal/total displays. Allocated quantities across colour rows for the existing sale RPC interface.
- Restricted the terminal and its sale action validation to cash. Added whole-KES tender checks, change preview, native checkout dialog keyboard handling, and an in-flight guard.
- Retained a checkout UUID across failed/uncertain retries; changed payloads cannot reuse that UUID. No browser financial persistence.
- Ported the old receipt renderer to the server-confirmed SaleRecord format. The receipt dialog is now portalled into a body-level print-root, matching the existing 80mm CSS. Receipt email is outside this phase's dialog.
- No schema changes, migrations, live access, real payments, or Phase 4 work.

Verification: lint, TypeScript, and production build checks run (see testing.md). Existing local containers were started without reset/migrations. A read-only pg_proc query found no public sale functions installed. Consequently scan → cash commit → database stock decrement → receipt printing could not be verified. Physical scanner/printer checks remain pending. Phase 3 is not marked complete.

RPC decision pending: the user requested pos_record_sale, but the old implementation accepts caller prices/identity and the repository contract flags it as legacy. The repository's existing action uses pos_create_sale, defined in an unapplied local migration. No RPC substitution or schema change was made as part of this phase.

## 2026-11-16 — Phase 3 sale migration and completed local verification

This entry supersedes the earlier missing-RPC blocker. Schema changes and local
reset were explicitly authorized; the live database remains untouched.

### Implementation

- Added `20261116100000_pos_sale_rpc.sql` after the existing baseline migrations.
  Its six-parameter `pos_record_sale` is SECURITY DEFINER with an empty search
  path, authenticated-only execute, and an active staff/session identity check.
- The UUID is claimed with `ON CONFLICT (client_uuid) DO NOTHING`; an owned
  replay returns false before stock changes. A new commit returns true.
- Verified every claimed unit price against the locked product's discounted KES
  price, summed the verified lines, compared the claimed total, and checked cash.
  Invalid prices/totals, empty/invalid carts, insufficient stock/cash and identity
  spoofing fail atomically. Product/colour locks use deterministic UUID order.
- Added `products.stock_quantity` as a trigger-maintained aggregate of colour
  quantities. Sale decrements and existing restock operations update both
  projections, with actor/reason/reference stock ledger rows. Added one
  manager-readable, RLS-protected `pos_sale_audit` event per committed sale.
- Updated `createSaleAction` and Zod payloads to call the new RPC with the
  server-derived cashier. Both new and replayed sales fetch historical receipt
  values. Retired authenticated execute on the alternate `pos_create_sale` RPC.
- Moved colour allocation into `lib/sales/cart.ts`. Removed extra cart discounts
  from cash checkout; catalogue discounts remain authoritative. Adjusted client
  discount arithmetic to match SQL rounding at half-KES boundaries.
- Added the terminal loading boundary required by this Next.js version and
  aligned the receipt number with the stored sale id.

### Verified locally

- `npx supabase db reset --local`: passed; six migrations and seed loaded through
  the local Podman Docker-compatible socket. No live target was selected.
- `pnpm auth:link`: two local seed staff linked successfully after reset.
- pgTAP: **40 passed**, covering prices/totals, caller identity, anon/disabled
  staff denial, audit RLS, overselling, duplicate cart lines, rollback, stock
  projection, catalogue discount rounding, replay and existing restock behavior.
- Playwright: **3 passed**. Cashier PIN login → category filter → unknown scan
  toast → product scan → cash charge → intentionally lost committed response →
  retry with the same UUID → stored receipt. The database showed one matching
  paid sale, its line and audit event, and exactly one stock decrement.
- Concurrent same-UUID requests returned true/false and decremented once.
  Concurrent last-unit purchases produced one success and one rejection, with
  one ledger movement and zero remaining stock.
- Print button invoked browser printing. Print-media checks hid the app and kept
  the 80mm receipt. Chromium generated a one-page 80mm × 297mm PDF, inspected
  with `pdfinfo` and `pdftotext`; screen receipt also visually reviewed.
- `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build`: passed.

Playwright setup is committed; generated artifacts are ignored under
`test-results/`. Test replenishment uses the existing manager stock RPC and
records a ledger reason. Temporary concurrency products are hidden from the
catalogue after tests. Test sales remain in the local database as evidence.
Physical USB scanner capture and thermal paper output still require devices.
No Phase 4 work was started.

## 2026-11-16 — Accepted Phase 3 receipt and search follow-up

- Reset print document, portal and dialog margins/padding; removed the dialog's
  centering offsets and backdrop. The receipt uses absolute positioning at
  top: 0 / left: 0, zero margin/padding, and an 80mm width. Other body children
  remain fully hidden during printing.
- Included the requested `@page { size: 80mm auto; margin: 0; }` declaration,
  preceded by an 80mm × 297mm fallback because Chromium rejects a length plus
  `auto`. Confirmed the production stylesheet preserves both declarations.
- Added `/pedigree-logo.png` above PEDIGREE LEATHER, centered at 120px maximum
  width, eagerly loaded directly from the local asset for receipt printing.
- Renamed the till search action to “Find” with a Search icon, available at mobile
  sizes too. Partial searches filter without adding even when only one result
  remains. Enter/Find adds an exact case-insensitive name or barcode match.
  Keyboard-wedge scans still add the matching loaded product automatically.
- Extended the existing browser cash-flow test to check partial search, exact
  barcode Enter, exact-name Find, automatic scanning, loaded logo, print origin
  at (0, 0), 80mm width and a centered logo no wider than 120px.

Verification: `pnpm build`, `pnpm lint` and `pnpm exec tsc --noEmit` passed.
`pnpm dev` was started; the existing server was restarted with fresh generated
assets when it continued serving a stale print stylesheet. The targeted local
Playwright scan/cash/print test passed. The print button was triggered, the
print-media screenshot visually reviewed, and `pdfinfo`/`pdfimages` confirmed
one 80mm × 297mm page with the embedded logo. Physical thermal-printer output
remains unverified. Phase 4 awaits approval.

## 2026-11-16 — Receipt focus and colour swatches

- Added `select-none` to the receipt modal heading and explicitly focused the
  Print receipt button after opening the native dialog, preserving the existing
  focus restoration when it closes.
- Enlarged product colour indicators to 20px circles (`size-5 rounded-full`),
  with a semantic border, subtle black ring and small shadow. Colour titles and
  stock quantities are retained.
- `pnpm build`, `pnpm lint` and `pnpm exec tsc --noEmit`: passed.
- Local browser verification opened the receipt after one local cash test sale:
  Print receipt held focus, the heading computed `user-select: none`, and the
  selected text was empty. Product swatches computed 20 × 20px with a 1px border,
  circular radius, visible ring and shadow. Screenshots were visually reviewed.

Phase 4 remains awaiting approval.

## 2026-11-16 — Circular main product placeholders

- Replaced the large solid square placeholder for products without photographs
  with a centered 64px circular colour swatch, a 2px semantic border ring and a
  subtle shadow. Actual photographs keep their existing rounded image styling.
- Retained the smaller circular variant swatches beneath the main image area.
- Confirmed the receipt modal already has `select-none` on its heading and
  explicitly focuses Print receipt when opened; browser verification again
  found Print focused and no selected text.
- `pnpm build`, `pnpm lint` and `pnpm exec tsc --noEmit`: passed. The local
  browser check confirmed the main swatch is 64 × 64px, circular, centered on
  both axes and ringed; the variant dots remain bordered 20px circles. Visually
  reviewed the product-card screenshot. Receipt verification used one local
  cash test sale.

Phase 4 remains awaiting approval.

## 2026-11-16 — Interactive colour selection and variant-aware cart

- Converted each product's colour dots into a native radio group with an
  accessible legend, per-colour labels/stock, keyboard arrow navigation, visible
  focus and a primary selection ring. Selection is held in the terminal parent.
  A single variant is selected automatically; multiple variants initially select
  the first in-stock colour (or the first colour when all are out of stock).
- The selected variant controls the photo/large swatch, stock label and Add to
  cart availability. Scanner and exact-search additions use the same selection.
- Cart identity is now product id + colour id. Different colours remain separate,
  show their names and have independent quantity/removal controls. Stock limits
  apply to that exact colour. Changing a card selection preserves existing lines.
- Replaced automatic stock allocation across colours with an explicit selected
  colour payload in `lib/sales/cart.ts`. The existing cash RPC validates it again
  and stores/decrements only the specified colour. Receipt lines show the stored
  colour name. No schema change was required.
- Reconfirmed the receipt heading already uses `select-none` and Print receives
  focus on open; no text selection was observed in browser verification.

Verification: build, lint and strict TypeScript passed. All **four** local
Playwright tests passed. The new flow switches the selection by mouse and arrow
key, checks the ring changes, adds Tan and Black as distinct lines, removes Tan,
exercises Black's stock limit, and sells one Black unit. The persisted sale item
contains Black's colour id/name; Black stock drops once while Tan is unchanged.
It also checks receipt focus and empty text selection. Existing cash, retry,
concurrency and 80mm printing checks remain green. Local test stock replenishment
continues through the manager ledger RPC; the live project was untouched.

Phase 4 remains awaiting approval.

## 2026-11-17 — Product images and Phase 4 management

### Product display (verified before management work)

- Added `ProductVisual`, rendering the selected colour's primary/front image as
  an 80px image with object-cover. Image sources update with radio selection.
  Missing and failed images fall back to the selected colour swatch; switching
  back to a valid image recovers correctly. No product photos were invented for
  catalogue rows that have no image URL.
- Local image verification used database image rows pointing to known local
  assets and checked loading, colour switching, object-cover and broken-image
  recovery before starting management implementation.

### Management implementation

- `/manager` now renders the overview; `/manager/dashboard` remains an alias.
  Manager-only SQL computes today's paid totals/count and recent sales using
  Africa/Nairobi day boundaries, plus low-stock totals and alerts. Aggregates
  are not truncated by the API row cap, and failures show an error instead of
  silently presenting zero sales.
- Added `/manager/products/new`: name, category, integer KES price, barcode,
  description, multiple colour names/swatches, initial stock and image URLs.
  Products are created atomically with colour/image rows, opening-stock ledger
  movements and an audit event. They are immediately active at the till and
  initially unpublished on the website. Creation carries a retry-safe UUID.
- Updated the stock dialog to a native focus-trapped modal supporting positive
  and negative changes with required reasons. Each adjustment has a stable UUID,
  manager identity, ledger reference and audit event. `/manager/inventory`
  displays the latest 100 movements with actor, time, product/colour, change,
  resulting quantity and reason.
- Added `/manager/staff`: safe roster and Add Cashier. Enrollment creates a
  confirmed Supabase Auth identity with a deterministic UUID and discarded
  random password, then commits an active cashier row through a manager-only
  RPC. Concurrent enrollment serializes active-PIN uniqueness checks; bcrypt
  verification material stays server-side. Known database rejections compensate
  a newly created Auth user; uncertain results preserve it for an idempotent
  retry. The role is fixed to cashier.
- PIN submission uses FormData because this Next.js version logs object action
  arguments in development. Verified its formatter emits `{}` for FormData;
  PINs/hashes are also excluded from audit payloads and roster projections.
- Manager navigation exposes Overview, Products, Inventory, Staff, Settings and
  Till on desktop and mobile. Added per-segment loading boundaries required by
  the installed Next.js instant-navigation rules.
- Repaired the existing editor to update colour rows in place, preserving ids
  referenced by completed sales. Removal of colours with stock or sale history
  is refused; edits are audited and cannot reprice historical sale lines.

### Local schema and verification

- Applied `20261116200000_pos_management.sql` and
  `20261116201000_pos_product_edit_history.sql` with local `migration up`.
  Existing sales/data were preserved; no reset or live database access occurred.
- `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build`: passed.
- Database suites: **75 passed** (40 cash checks plus 35 management checks).
  Covers anon/cashier/disabled-manager denial, private helpers, audit RLS,
  idempotency/mismatched replay, opening stock, adjustment rollback, unique PINs,
  bcrypt storage, fixed cashier role, and history-preserving catalogue edits.
- Browser suites: **7 passed**. Manager PIN login → overview → add product with
  two colours/images → +2/-1 audited adjustments → inventory history → POS
  product/image switching. Also enrollment, duplicate-PIN rejection, new-cashier
  PIN login, manager-route denial, and mobile navigation without horizontal
  overflow. Existing cash, retry, concurrency, variant and receipt checks passed.
- Reviewed desktop overview, product-image and mobile staff screenshots.
  Image tests use local fixture assets to avoid external network dependencies.
  Generated product fixtures are hidden after tests; enrolled fixture cashiers
  are disabled. Local audit/sale evidence remains preserved.

The requested Phase 4 management scope is complete locally. Returns, advanced
reporting and production/shared-storefront rollout have not been implemented or
claimed as verified by this work.


## 2026-11-17 — Phase 7 M-Pesa

- Added local-only versioned migrations for payment drafts and attempts, safe
  polling grants/RLS, service-only callback operations, immutable price snapshots,
  idempotent finalization and stock/audit writes through `pos_record_sale`.
- Implemented server-only OAuth, STK initiation/query, phone validation, per-attempt
  callback capabilities, callback evidence storage and independent provider checks.
- Added checkout phone entry, PIN waiting, polling, timeout/status recovery and
  manual receipt-code capture. Manual codes remain unverified; unresolved funds
  block conflicting cash or repeat charges. Confirmed receipts include M-Pesa codes.
- Neutralized legacy initiation/callback paths so they cannot bypass verification.
- Notification logic implemented for STK Push. Separate C2B registration,
  validation and confirmation endpoints remain outside this implementation.
- Verification: 115 SQL checks passed. Local mock server scenarios passed for
  amount/callback validation, provider confirmation, replay, declines, lost
  responses, early callbacks, manual-code safety and stock-race reconciliation.
- Final quality gates: `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build` all passed.
- Exact phase file inventory and manual checklist: `docs/phase-7-files.md`.
- Playwright browser checks are flaky and deferred by explicit user instruction.
  No further browser timing fixes or browser regression runs will be performed.
  Manual checkout/receipt acceptance remains pending.
- Real Daraja sandbox credentials, public HTTPS callback delivery and live
  payments remain untested. The shared/live database was not accessed.

Stopped after the requested Phase 7 work; hardware and later phases await approval.


## 2026-11-17 — Phase 5 settings and currency

- Added/applied local migration `20261117100000_pos_exchange_rate.sql`:
  numeric `exchange_rate_kes_to_usd`, default 130, positive bounded validation,
  one fixed settings key/row, no application insert/delete, manager-only updates.
  Unexpected additional shared settings abort migration rather than discard data.
- Preserved existing JSON exchange-rate readers with a synchronized projection;
  trigger stamps actor/time. Removed the previous anonymous write policy.
- Updated the existing manager-protected settings page and Server Action to use
  the numeric field directly with Zod validation, decimal preservation and the
  requested success toast. Settings navigation already existed and was retained.
- `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`: passed.
- All 125 database checks passed, including ten settings authorization,
  singleton, decimal persistence, compatibility and actor checks.
- Local authenticated Supabase manager update saved 132.75; an independent
  read confirmed persistence and synchronized JSON. Original rate restored.
- No browser automation was run. Actual storefront refresh/cache behavior and
  live/shared schema compatibility are not verified; no live project was touched.


## 2026-11-17 — Phase 6 VFD and barcode scanner

- Installed `@point-of-sale/webserial-customer-display` and copied the old POS
  ambient declaration. Old project remained read-only.
- Adapted its external-store controller into `lib/customer-display.ts`, exposed
  through `hooks/use-customer-display.ts` with `useSyncExternalStore` and a stable
  server snapshot. No Dexie or financial state persistence was added.
- Web Serial construction/connection runs only from a client gesture, with
  secure-context/browser checks. Cancelled/failed connections reset status;
  device write failure is isolated from checkout.
- Latest-wins rendering keeps one in-flight frame and one replaceable pending
  frame. Two-line replacement avoids stale scrolling totals. Empty cart paints
  `WELCOME TO PEDIGREE`; cart changes paint `TOTAL: KES [amount]`.
- Added Connect Display/status UI to the POS top bar. Cart effect lives in the
  existing client `PosTerminal`; `app/pos/page.tsx` remains a server catalogue read.
- Existing ported keyboard-wedge scanner already adds loaded catalogue matches.
  Preserved search/input/modal exclusions and stock checks; reset stale buffers
  around excluded input, paused scanning, modifiers, repeats and IME composition.
- Added the old webpack `resolve.conditionNames` browser-export fix and a narrow
  equivalent package alias for this repository's Turbopack build.
- Simulated-device test passed: disconnected/in-flight latest-wins behavior,
  serialized frames, welcome and reconnect. Run with
  `node tests/hardware/customer-display.test.mjs`.
- Physical VFD, USB scanner, browser serial permissions and device compatibility
  require manual acceptance. No browser automation, database schema changes,
  live database access or payment processing was performed in this phase.

Final Phase 6 gates: `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build`
passed. Requested code scope complete; awaiting manual hardware acceptance.


## 2026-11-17 — Phase 5 Real-Time Web Order Notifications

**Requested implementation: complete.**

- Added guarded migration `20261117110000_pos_realtime_orders.sql` to publish
  the storefront-owned orders table through Supabase Realtime, enable RLS and
  allow active cashiers/managers to read incoming orders. A restrictive SELECT
  policy blocks disabled POS staff despite legacy permissive storefront policies.
  Existing storefront access is preserved; no order writes or line-item
  publication were added. The migration requires the existing storefront schema.
- Inspected the actual storefront checkout source read-only: it inserts
  `pending_payment`, not the originally suggested `awaiting_payment`. The hook
  filters INSERTs for pending_payment, pending and awaiting_payment and validates
  id, order number, customer name and integer KES total through Zod.
- Added `hooks/use-realtime-orders.ts`, a client listener mounted in the protected
  till and manager shells. It cleans up subscriptions/timers/audio, deduplicates
  recent event ids in memory, refreshes authentication, and shows connection
  status. No offline storage, money/stock writes or payment-success claims.
- Added a private/no-store authenticated token bridge because existing login
  cookies are HttpOnly. Only the staff access JWT is sent to the nonpersistent
  Realtime client; service-role credentials and refresh tokens remain server-side.
- New Web Order! toasts display order number, customer name and formatted KES
  total, remain until dismissed, and survive bursts of cart notifications.
  Toast stack scrolls when needed. Optional quiet Web Audio chime is enabled by
  user interaction and cannot block checkout when audio is unsupported/blocked.
- Updated architecture, database contract, features and testing notes. Added nine
  SQL authorization/publication checks; these require a storefront test schema.
- No optional pending-count badge: INSERT arrival alerts are not an authoritative
  pending-order count, and disconnected clients do not replay missed orders.

Verification: `pnpm lint` and `pnpm exec tsc --noEmit` passed. `pnpm build`
was attempted but Turbopack could not bind its CSS worker port in the sandbox
(Operation not permitted). `pnpm build --webpack` then passed, including TypeScript, all 25 generated
pages and build tracing. No live websocket or audio behavior was tested.
The SQL suite could not run because Podman cannot access its runtime configuration
inside the sandbox. No migrations were applied locally or to shared/live data.


## 2026-11-17 — Phase 4 expanded: manager product management

Phase 5 real-time orders accepted by the user. Expanded manager implementation
is complete in code; runtime/database verification remains pending.

- Retained the existing guarded manager product list with name, integer KES
  price, colour-derived stock, barcode and Edit/Adjust stock actions. Website
  badges now explicitly say Published/Draft.
- Both product forms now call the manager-guarded, Zod-validated `upsertProduct`
  Server Action. Existing transactional RPCs write shared products and related
  variants/images. Added Publish on website on creation; editing already exposes
  the flag and now uses the shared action. Custom colours remain supported, with
  new preset checkboxes for colour multi-selection.
- Added a stock quantity section and adjustment modal on the edit page, while
  retaining adjustment access from the list. `adjustStock` requires manager
  authorization, signed units, a reason and a retry-safe UUID. Stock remains on
  canonical colour rows; no independent browser or product-level stock counter.
  Inventory history is revalidated after adjustment.
- Added migration `20261117120000_pos_product_publishing.sql`: creation saves the
  publication boolean (default draft), opening ledger rows carry the request UUID,
  and private trigger writes manager opening/adjustment movements atomically to
  new `pos_stock_adjustments`. Includes before/after quantity, delta, actor,
  reason, time, request and unique ledger reference. Manager-only read RLS and
  revoked direct writes protect audit rows. Replay does not duplicate stock/audit;
  deletion of colours with adjustment history is refused with a clear error.
- Reviewed the storefront source read-only. Public reads require published,
  active products and available colour stock through queries/RLS. Shared database
  visibility is the sync boundary. Its prerendered catalogue pages have no
  existing cross-app revalidation endpoint; instant rendered page updates need
  coordinated storefront invalidation/request-time reads. No storefront source
  was modified and that integration is not claimed as complete.
- Added SQL authorization/publication/audit coverage and expanded the existing
  manager browser flow to create a published bag, adjust +2/-1, inspect audit rows,
  unpublish/republish, check anonymous database visibility and view it at the till.

Verification:

- `pnpm lint` — passed.
- `pnpm exec tsc --noEmit` — passed, including the expanded test source.
- `pnpm build --webpack` — passed, all 25 pages generated. Initial attempt failed
  parsing empty TypeScript --showConfig output; direct config JSON parsing passed
  and a build retry passed without changing configuration.
- Integration blocked: Podman runtime is read-only, local Auth fetch returns
  EPERM, and Next start cannot bind loopback (listen EPERM). The new SQL/browser
  tests were therefore not run, no test product was created, and stock/public
  visibility was not observed against a running database during this task.
- Migration was not applied locally or to shared/live data. Existing prior-phase
  test results remain historical evidence, not verification of these changes.
- Required Next.js feedback reporting command was attempted; see testing notes
  for the network restriction if enablement lookup remains unavailable.


## 2026-11-17 — Returns & Refunds

**Requested returns implementation: complete in code and build-verified.**
Manager Product Management accepted before starting this feature.

- Added `20261117130000_pos_returns.sql` with pos_returns and pos_return_items:
  original sale/item references, manager identity/name, reason, quantities,
  historical item snapshots, integer refund amounts, timestamps and unique
  client UUID. RLS limits reads to active managers and direct application writes
  are revoked. Private allocation helper and all RPCs have pinned search paths
  and revoked PUBLIC/anonymous execution.
- `pos_process_return` authorizes the active manager, serializes retry UUID and
  original sale, validates paid status, original item ownership and remaining
  quantities, and atomically records refund/items, restocks original colours and
  writes positive stock movements. The existing required projection trigger
  increments products.stock_quantity exactly once in the same transaction.
  Missing historical colours fail rather than allocate stock to another colour.
- Server-derived refund budgets use immutable sale totals/lines and include
  discounts. Integer cumulative allocation preserves rounding across partial
  returns and caps the combined refund at the original paid total. Current prices
  are ignored. Original financial sale/item values are never edited.
- Added manager Returns navigation, `/manager/returns` and a loading boundary:
  search the printed eight-character receipt/full sale UUID or choose among 50
  recent paid sales, select quantities, enter reason and authorize the return.
  Ambiguous short receipt numbers remain selectable; already-returned quantities
  and server-derived refund previews are displayed.
- Added `processReturn` Server Action with requireManager/Zod, a busy guard,
  stable request UUID, frozen retry payload after uncertain results and same-return
  receipt recovery. Replays cannot restock/refund twice; confirmed partial returns
  can explicitly start a new return for remaining units.
- Success toast offers a printable 80mm Return Receipt with original receipt,
  manager, reason, returned quantities and refund total. Return history supports
  reprints/recovery, scoped to the selected sale. Print failure cannot undo or
  duplicate a committed return.
- Refunds are recorded for manual settlement. No provider reversal or claim of
  money transferred is made. Existing dashboards retain gross-sale totals;
  refunds are listed separately. Optional cashier PIN authorization was omitted;
  the manager signs in to authorize through the protected manager workspace.

Verification:

- `pnpm lint` — passed.
- `pnpm exec tsc --noEmit` — passed.
- `pnpm build --webpack` — passed with the new /manager/returns route (26 pages).
- Four refund-preview checks passed via
  `node --experimental-strip-types tests/returns/refund.test.mjs`.
- Added 39 SQL authorization/atomicity/refund/stock checks and a browser scenario
  for manager login, receipt lookup, lost-response retry, printing/reprinting and
  simultaneous requests for the final returnable unit. Test sources compile.
- `pnpm test:rls` was attempted but Supabase CLI failed writing telemetry to a
  read-only home directory before connecting. The SQL checks were not executed.
  Browser checks were not run; existing network/loopback/container sandbox limits
  prevent local runtime acceptance. No stock/refund operation was executed here.
- Migration remains unapplied locally and on shared/live Supabase. Database
  concurrency, real stock writes, RLS and actual browser/physical printing are
  not claimed as verified. Architecture, database contract, features and testing
  notes now describe these boundaries and the manual acceptance procedure.


## 2026-11-17 — Cashier Manager PIN approval and premium digital documents

**Requested implementation: complete in code and build-verified.**

### Cashier returns with manager approval

- Added Return on the till and `components/pos/return-dialog.tsx`: lookup the
  printed receipt, choose the matching paid sale, select return quantities/reason,
  and ask the manager to enter a masked four-digit Manager PIN.
- Reused the existing return form/refund preview and atomic pos_process_return.
  PIN submission uses FormData; the PIN input clears immediately and no PIN/hash
  is sent to browser state, persisted in return payloads or explicitly logged.
- Added service-only pos_process_return_with_pin and durable per-cashier PIN
  attempts. Approval requires exactly one matching active, linked manager; cashier,
  ambiguous duplicate and disabled-manager PINs fail. Five failed attempts cause
  a 30-second lockout. The server supplies the authenticated requesting staff ID.
- The SQL bridge scopes/restores manager identity around the existing atomic RPC
  without minting sessions or changing cashier cookies. Returns audit both
  processed_by (manager) and requested_by (cashier). Cashiers cannot execute the
  bridge directly or gain manager refund-audit reads.
- Pending/uncertain returns keep the payload/UUID frozen and the dialog open;
  retry requires manager approval again and can recover a fully-returned sale's
  receipt without double restocking/refunding. Manager workspace authorization
  continues to work separately. Scanner input pauses while return/quote dialogs
  are open, and pending payments disable conflicting till actions.

### Premium digital receipts and quotations

- Added `components/digital/document-template.tsx`: responsive premium brand
  layout with logo, warm semantic tokens, customer, EAT date, item pictures/colour
  swatches, quantities/prices, serving cashier, totals and Karibu Tena footer.
  It has its own full-page/A4 styles and no thermal 80mm receipt classes. Existing
  thermal sale printing remains a separate option.
- Added Create Quote next to Charge. Customer name/phone are submitted via
  FormData to an active-staff guarded action. pos_create_quotation derives integer
  prices/discounts and snapshots product/colour/image data in pos_quotations with
  a retry UUID and unique quote ID. It neither reserves stock nor records payment.
- Sale success now offers Send to WhatsApp / Email, collecting the customer before
  displaying the premium receipt. pos_create_receipt_document verifies the paid
  sale and snapshots original amounts/cashier/date; current images/swatches only
  enrich the saved document. Browser-submitted totals are not used.
- Added UUID-capability customer pages at /documents/[kind]/[id]/[token]. Owning
  staff/managers can read documents via RLS; anonymous table reads and direct
  writes are denied. The public route checks both document ID and random token
  using a server-only read. Pages use no-index/no-referrer/no-store headers;
  images omit referrers and Next request logging skips capability paths.
- WhatsApp links use normalized international numbers and encoded receipt/quote
  messages plus the customer document URL. Staff review and send in WhatsApp;
  opening a link is not reported as delivery.
- Reused Resend for premium escaped HTML email with stored document authorization
  and provider idempotency. The endpoint accepts document IDs rather than arbitrary
  browser sale contents. UI distinguishes provider acceptance from actual delivery
  and handles missing email configuration without blocking WhatsApp sharing.
  Added RESEND_API_KEY, RESEND_FROM_EMAIL and POS_PUBLIC_URL documentation.

### Migration and verification status

- Added migrations 20261117140000_pos_return_pin_approval.sql and
  20261117141000_pos_digital_documents.sql. Neither was applied locally or live.
- `pnpm lint` — passed.
- `pnpm exec tsc --noEmit` — passed, including the new browser scenario.
- `pnpm build --webpack` — passed, 27 page generations and new shared-document
  route. Initial attempt failed parsing empty TypeScript --showConfig output;
  direct output parsed successfully and retry passed without configuration changes.
- Four Node tests passed via
  `node --experimental-strip-types --import ./tests/digital/alias-loader.mjs tests/digital/documents.test.mjs`.
  Covers WhatsApp phone/URL encoding, quote IDs/paid distinction, premium responsive
  HTML without thermal classes, and escaped premium email HTML.
- Added 37 SQL checks for PIN authorization/lockout/context restoration/audit,
  quote pricing/retry/no-stock-effects, paid receipt snapshots and document RLS.
  `pnpm test:rls` was attempted but CLI telemetry writing is blocked by the
  read-only home directory; no SQL tests ran or backend mutations occurred.
- Added a browser scenario for cashier approval, wrong PIN rejection, unchanged
  cashier identity, quote/receipt creation, private/invalid links, mobile layout
  and mocked email failure. It was not run because local runtime/database access
  remains restricted. No actual WhatsApp/email message or provider call was sent.
- Backend authorization/stock effects, browser appearance, publicly reachable
  links, production log redaction and email provider delivery remain acceptance
  work. Private document links are bearer capabilities with no automatic expiry;
  link holders can view them. Real email needs a configured key and verified sender.
- Updated database contract, architecture, features and testing notes. The required
  Next feedback command was attempted once but could not check enablement without
  network access; this session cannot elevate network permissions.


## 2026-11-17 — Flutterwave Card Payments

**Requested Card Payment flow: implemented and build-verified.** Returns and
Digital Documents accepted before this work.

- Added NEXT_PUBLIC_FLW_PUBLIC_KEY and server-only FLW_SECRET_KEY to .env.example.
  Real .env.local keys were not inserted/changed. No payment was triggered.
- Added card preparation actions and pos_card_payments in migration
  20261117150000_pos_flutterwave.sql. Active staff receive a server-priced cart
  snapshot and stable, stored POS-CARD UUID reference. An open-draft index,
  original snapshot comparison and provider transaction uniqueness prevent
  repeated initiation/replay from changing the committed financial intent.
- POST /api/flutterwave/verify authenticates/authorizes staff and compares request
  amount to the stored expected amount before contacting the fixed provider HTTPS
  endpoint with the secret key. Independently verifies successful status, exact
  reference/transaction ID, whole-KES sufficient amount, currency KES and card
  payment type. Callback success/client totals alone never mark a sale paid.
- Added service-only pos_finalize_card and expanded the existing pos_record_sale
  to accept only matching verified card evidence/snapshots through the service
  role. It atomically writes paid card sale/items, original-colour stock/product
  projection, ledger and card audit. Existing cash/M-Pesa contracts are preserved,
  with additional durable cross-method conflict guards. Replay does not repeat
  stock writes; evidence is retained in reconciliation when stock cannot finalize.
- Added components/pos/flutterwave-checkout.tsx with client-only v3 script loading,
  requested triggerFlutterwavePayment function and card-only hosted config.
  It collects customer email/phone only; raw card entry stays inside Flutterwave.
  Browser callbacks contribute only an untrusted transaction ID for server checks.
  Provider card/token/customer payloads are neither persisted nor logged.
- Checkout now has Cash, M-Pesa and Card tabs, Pay with Card and Processing Card...
  UI. The native dialog temporarily yields to Flutterwave's overlay, then resumes
  for verification. Only confirmed server receipts trigger success, checkout close
  and browser printing; printer failure leaves the committed receipt available.
- Added Check Card Status/reference recovery for missing callbacks/lost responses,
  server restoration after reload (even with an empty cart), guarded prepared-draft
  cancellation and stale callback suppression. Opened/uncertain payments do not
  unlock on close/timeout, start another charge or fall back to cash automatically.
  Safe recovery remains available after stock resolution; unresolved provider
  failures/closed sessions require manager/provider reconciliation.

Verification:

- `pnpm lint` — passed.
- `pnpm exec tsc --noEmit` — passed.
- `pnpm build --webpack` — passed (28 page generations, including the new API).
- Five verification-rule Node tests passed and two mocked server-HTTP tests passed
  (seven total). Covers mismatched/underpaid/incorrect currency/status/method/ID,
  integer KES limits, overpayment, stripped provider metadata, fixed endpoint,
  server secret header/no caching/no redirects and reference recovery/HTTP errors.
- Added 38 SQL tests for authorization, server pricing, original snapshot replay,
  durable payment locks, verified-only card commits, audit/stock exactly once,
  evidence conflicts, stock-race rollback/reconciliation and safe cancellation.
  `pnpm test:rls` was attempted but Supabase CLI telemetry writing failed on the
  read-only home directory before connecting. SQL tests were not executed.
- Added a local-only mocked-provider browser test for card config, lost verification
  response, same-sale recovery, frozen prices, one stock decrement and one print
  request. It was authored/type-checked but not run; configured test keys/rebuilt
  app and a usable local database/server are required.
- The migration remains unapplied locally/shared/live. Provider checkout, actual
  3DS/OTP, account KES/card eligibility, stock/RLS/concurrency in a running database,
  browser overlay/focus and physical printing remain unverified. No webhook,
  automatic provider refund or unsafe force-cash override was added.
- Updated architecture, database contract, features and testing notes, including
  links to the primary Flutterwave v3 docs used for this integration.

## 2026-11-17 — POS-only reset: optional storefront orders

- Fixed `20261117110000_pos_realtime_orders.sql` to emit the expected notice and
  return from its DO block when public.orders is absent. POS-only databases no
  longer require a fabricated storefront table for this migration.
- Moved all orders-specific RLS, grants and policies into the same guarded block;
  changing only the exception would still fail on those later statements.
  Publication membership is only altered when orders exists, and existing
  storefront environments retain the publication/RLS setup and duplicate guard.
- Updated the database contract: if storefront tables are provisioned later,
  rerun this setup SQL after review to enable notifications.
- `npx supabase db reset` was attempted as requested but failed before reaching
  PostgreSQL: npm registry DNS lookup returned EAI_AGAIN. The installed
  `supabase db reset` fallback also failed before connecting because CLI telemetry
  tries to write to the read-only home directory (EROFS).
- Reset completion and SQL execution therefore remain unverified in this sandbox.
  No shared/live project was reset or changed. Lint and strict TypeScript passed;
  `pnpm build --webpack` also passed (28 page generations).

## 2026-11-17 — Sandbox reset retry, C2B callbacks and URL registration

- Confirmed the realtime orders migration already contains the missing-table
  notice/early return, with publication, RLS, grants and policies inside that
  guard. POS-only databases do not need a fabricated storefront orders table.
- Retried `npx supabase db reset` (bounded npm timeout/retries). Registry DNS
  failed with EAI_AGAIN before the CLI could connect.
- Found the installed CLI supports SUPABASE_HOME and telemetry opt-out. Retried
  local reset with SUPABASE_HOME=/tmp/pos-supabase-cli,
  SUPABASE_TELEMETRY_DISABLED=1 and DO_NOT_TRACK=1. This gets past the prior
  read-only telemetry failure and explicitly targets local 127.0.0.1:54322, but
  Podman service inspection fails on its read-only runtime directory. Reset did
  not reach migrations and completion is not verified. No live reset was run.
- Added POST /api/mpesa/c2b/confirmation. It validates a bounded C2B notification,
  logs only a stable transaction fingerprint, decimal amount text and unverified
  marker, and immediately returns {ResultCode:0,ResultDesc:"Accepted"}. No phone,
  customer name, account reference, full callback or credential enters logs.
  Malformed requests return 400 without echoing their contents.
- Added the companion C2B validation route needed for URL registration. Both
  endpoints acknowledge observations only: no paid sale, stock change or financial
  verification is inferred from a public callback. Existing STK verification is
  unchanged; C2B matching/reconciliation remains separate.
- Added scripts/register-mpesa-urls.ts and `pnpm mpesa:register-urls`. The script
  loads .env.local, obtains OAuth and registers confirmation/validation URLs via
  the official C2B v1 endpoint. Existing full STK callback URLs are normalized to
  /api/mpesa before appending /c2b/confirmation and /c2b/validation, so the current
  callback configuration remains untouched and does not produce a nested route.
- Added --dry-run and explicit --production protection, optional
  MPESA_C2B_SHORTCODE (otherwise MPESA_SHORTCODE), bounded no-redirect network
  requests and secret-safe output. It needs only consumer credentials, shortcode
  and callback URL, not the STK passkey. Success is reported only on provider
  ResponseCode 0.
- Confirmed configured environment is Sandbox and callback uses the existing
  /api/mpesa/callback path without printing credentials or the Ngrok host.
  Actual Sandbox registration was attempted but OAuth DNS failed with EAI_AGAIN.
  No URLs were registered, no credentials validated remotely, and no payment/STK
  Push/simulation was initiated. Fresh .env.local values were not modified.
- Eight C2B/registration tests passed through Node with mocked HTTP, covering
  accepted/redacted callbacks, malformed data, correct URL construction, OAuth
  and registration payloads, dry run, production guard, provider denial and safe
  errors. Test helper resolves Next's server module for handler-level tests.
- `pnpm lint`, `pnpm exec tsc --noEmit` and `pnpm build --webpack` passed
  (30 page generations, including both C2B routes). Architecture, database
  contract, features and testing notes were updated.


## 2026-11-17 — Explicit environment loading for C2B registration

- Changed the package registration command to preload .env.local with Node's
  --env-file flag before executing the TypeScript script.
- Direct script execution also resolves .env.local relative to the script/project
  root and now fails clearly if it cannot be loaded, instead of silently ignoring
  a missing/unreadable file based on the working directory.
- Consumer key/secret validation trims surrounding whitespace and rejects missing
  or blank values before OAuth. The validated values form the Basic Authorization
  header; credentials are not printed. The previous implementation already used
  loadEnvFile before OAuth and validated missing credentials, so undefined values
  were not established as the cause of the reported HTTP 401.
- Ran `pnpm mpesa:register-urls` with explicit loading: configuration validation
  succeeded but OAuth transport failed with EAI_AGAIN. Safaricom did not respond;
  registration success and resolution of the reported HTTP 401 are unverified.
- Nine C2B/registration tests passed, including missing/blank credential rejection
  before any HTTP request and trimmed credential values in the OAuth header.
  `pnpm lint`, `pnpm exec tsc --noEmit` and `pnpm build --webpack` passed
  (30 page generations).

## 2026-11-17 — Safe OAuth request diagnostics

- Added CLI diagnostics immediately before OAuth fetch: exact provider URL,
  redacted Basic Authorization scheme, requested four-character consumer-key
  prefix, credential/header lengths and SHA-256 fingerprint of the header.
  Full Basic values are reversible credential pairs and are not logged/pasted.
- OAuth still sends the complete validated Basic header privately over HTTPS;
  diagnostic redaction does not alter the outgoing header. Mock tests check the
  actual Authorization value independently of displayed diagnostics.
- Ran `pnpm mpesa:register-urls`: both credential values were present and the
  endpoint selected Sandbox, but DNS failed with EAI_AGAIN before an HTTP response.
  No HTTP 401 was reproduced, no registration succeeded and no keys were changed.
- Added a diagnostics regression test checking deterministic fingerprint/length
  and absence of the full key, secret and Base64 value. All ten C2B tests, lint
  and TypeScript passed. `pnpm build --webpack` also passed (30 page generations).

## 2026-11-17 — M-Pesa ENV-to-STK walkthrough

- Added mpesa.md explaining the current ENV mapping, OAuth header, Nairobi
  timestamp, generated STK password, placeholder request body, signed callback
  and server verification flow. Clarifies that C2B URL registration does not
  initiate an STK prompt.
- Read local configuration without printing/copying secret values. Noted that
  MPESA_CALLBACK_SECRET is absent and the current STK configuration requires
  at least 32 characters before initiation. No ENV values were changed and no
  payment/network request was made. Documentation-only change.

## 2026-11-18 — POS favicon

- Replaced the default favicon with the existing Pedigree Leather logo at
  16, 32 and 48 pixels. Next.js serves it at `/favicon.ico`.

## 2026-11-18 — Storefront settings migration compatibility

- Removed the sales migration's settings seed and grants. The exchange-rate
  migration skips storefront schemas that do not match the POS layout and
  tables that contain additional settings. The manager dashboard retains its
  default rate when the POS exchange-rate row is absent.
- The remote schema query and migration push were blocked by a missing Supabase
  access token. Local pgTAP could not connect to PostgreSQL.
