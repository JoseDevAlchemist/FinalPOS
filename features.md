# Features — Pedigree POS 2.0

Statuses: **Not started**, **In progress**, **Implemented**, **Tested**,
**Blocked**, **Deferred**.
A feature is not complete because a component exists; see the Definition of Done
in `AGENTS.md`.

## Foundation

| Feature | Phase | Status | Notes |
| --- | --- | --- | --- |
| Project scaffold (Next 16, React 19, TS strict, Tailwind 4) | 0 | Implemented | Created by scaffold; not yet exercised by app code. |
| Design tokens and typography | 0 | Implemented | `app/globals.css`, Manrope + Cormorant in layout. |
| Documentation set | 0 | Implemented | AGENTS, architecture, database contract, guideline, features, progress, testing. |
| Supabase browser/server clients | 0 | Implemented | `@supabase/ssr`, untyped until Phase 2. |
| Environment template | 0 | Implemented | `.env.example`; no real secrets committed. |
| Folder conventions | 0 | Implemented | Empty domain folders established. |

## Authentication and access

| Feature | Phase | Status | Notes |
| --- | --- | --- | --- |
| PIN keypad sign-in / sign-out | 1 / 2 | Tested locally | Route handler verifies bcrypt `pin_hash`; session cookies are set and cleared. Local cashier and manager login both verified. |
| Supabase Auth session exchange | 1 / 2 | Tested locally | Admin link exchange plus `verifyOtp`; `@supabase/ssr` HTTP-only cookies observed in a production server run. |
| Staff profile linked to auth user and role | 2 | Implemented locally | `auth_user_id` migration plus idempotent `pnpm auth:link`; live project not linked yet. |
| Manager/cashier route guards | 1 / 2 | Tested locally | `proxy.ts` protects both routes; pages call `requireStaff()`/`requireManager()`; cashier `/manager` response has no manager content. |
| Session refresh Proxy and expiry UX | 1 | Implemented | `proxy.ts` refreshes cookies and redirects to `/login`. |
| Disabled staff handling | 1 / 2 | Tested locally | Inactive rows are not matched; unlinked rows return `staff_not_linked`. |
| Staff roster RLS | 2 | Tested locally | Anon denied; cashier reads own safe columns only; `pin_hash` denied; manager reads roster. |
| PIN enrolment provisioning | 2 | Implemented locally | `scripts/link-pos-users.mjs` creates Auth users and links rows; dry-run and idempotency verified. |
| Manager-only actions re-checked server-side | 1 / 4 | Tested locally | Guards plus active-manager checks inside RPCs; disabled staff denied. |

## Catalogue and inventory

| Feature | Phase | Status |
| --- | --- | --- |
| Product grid, search, category filter | 3 | Tested locally |
| Barcode scanning and unknown-code handling | 3 / 6 | Browser tested; physical scanner pending |
| Product create/edit with images | 4 | Original flows tested locally; expanded publishing/multi-select implemented and build-verified |
| Stock adjustment with ledger + reason | 4 | Original ledger flow tested locally; pos_stock_adjustments extension implemented, integration pending |
| Shared stock with storefront | 5 | Shared colour-stock contract implemented; live compatibility/cache refresh pending |
| Low-stock and inventory reports | 4 | Low-stock alerts and latest 100 stock movements tested locally; advanced reports pending |
| Barcode privacy from public queries | 2 | Not started |

## Sales terminal

| Feature | Phase | Status |
| --- | --- | --- |
| Cart add/remove/quantity | 3 | Implemented and cash flow tested locally |
| Server-priced totals and catalogue discounts | 3 | Tested locally |
| Idempotent sale commit | 3 | Tested locally, including concurrent and lost-response retries |
| Cash checkout and change | 3 | Tested locally |
| Flutterwave hosted card checkout | 7 | Implemented; server verification/mocked tests; provider/database/browser acceptance pending |
| Receipt rendering and 80mm print | 3 | Browser/PDF tested; physical thermal output pending |
| Receipt reprint with indicator | 4 | Not started |
| Connectivity gate on checkout | 3 | Not started |

## Payments

| Feature | Phase | Status |
| --- | --- | --- |
| Payment intent persistence | 7 | Not started |
| Daraja STK Push initiation | 7 | Not started |
| Callback verification and dedupe | 7 | Not started |
| Pending/timeout/reconciliation states | 7 | Not started |
| Cash / card / M-Pesa distinction | 7 | Implemented; card verification and reconciliation added; live acceptance pending |

## Manager portal

| Feature | Phase | Status |
| --- | --- | --- |
| Dashboard paid totals, transaction count, recent sales and low stock | 4 | Tested locally with EAT day boundaries; payment-mix report pending |
| Sales history, filters, receipt lookup | 4 | Not started |
| Returns with approval and caps | 4 | Manager flow plus cashier Manager PIN approval implemented; runtime acceptance pending |
| Staff roster and cashier enrollment | 4 | Tested locally with Supabase Auth, unique PIN, fixed cashier role and audit |
| Exchange-rate setting and audit | 5 | Not started |
| Reports in East Africa Time | 4 | Not started |
| Website order notifications | 5 | Implemented; webpack build verified; live acceptance pending |

## Hardware

| Feature | Phase | Status |
| --- | --- | --- |
| VFD connect/reconnect/status | 6 | Not started |
| VFD total, tender and payment messages | 6 | Not started |
| VFD simulator | 6 | Not started |
| Keyboard-wedge scanner integration | 6 | Not started |
| Thermal print CSS and isolated print root | 3 / 6 | Browser/PDF verified; physical device pending |

## Reliability and security

| Feature | Phase | Status |
| --- | --- | --- |
| RLS authorization tests | 2 / 3 | Cash RPC/audit pgTAP suite: 40 passed; staff roster retains prior manual verification. |
| Offline indicator and disabled checkout | 3 | Not started |
| Duplicate checkout / last-item race handling | 3 | Tested locally |
| Audit log for sensitive actions | 2 / 4 | Cash, product creation/edit, stock and enrollment covered locally |
| Rate limiting for sensitive endpoints | 7 / 8 | Not started |
| E2E, concurrency and performance tests | 4 / 8 | Seven local E2E tests include concurrency; performance work pending |

## Deferred

Offline selling, sale queues, local PIN hashes, loyalty, multi-branch, native
card acquiring, supplier/warehouse logistics.

## Phase 4 product imagery and navigation

Product cards load the selected colour's primary image with object-cover and
recover to a circular swatch on missing/broken URLs. Manager navigation includes
Overview, Products, Inventory, Staff, Settings and Till, and is verified on
mobile. Product creation includes per-colour image URLs and opening stock.
Current local verification totals: 75 SQL checks and seven E2E tests passed.


## Phase 7 payment processing

M-Pesa STK initiation, verified STK callback notifications, atomic completion,
status polling and unverified manual-code capture are implemented. Backend
verification: 115 SQL checks and local Safaricom mock server scenarios passed.
Playwright UI checks are flaky/deferred; manual UI acceptance is pending.
Daraja C2B validation/confirmation acknowledgement endpoints and Sandbox URL
registration are implemented; real callback delivery/registration remain unverified.


Phase 6 requested VFD/scanner code is integrated. Connect Display, live total,
empty-cart welcome and latest-wins frame serialization are implemented. The
existing keyboard-wedge scanner remains integrated with input/modal exclusions.
Simulated VFD checks passed; physical hardware acceptance remains pending.


## Digital documents and cashier approval

| Feature | Status |
| --- | --- |
| Cashier return modal and server-only Manager PIN approval | Implemented; durable lockout and approval audit; database/browser acceptance pending |
| Premium responsive digital receipts and quotations | Implemented; HTML render/escaping tests passed; browser acceptance pending |
| Server-priced pos_quotations with retry UUID | Implemented; no stock reservation/sale; database acceptance pending |
| Private customer document links and prefilled WhatsApp messages | Implemented; link/phone tests passed; deployed sharing unverified |
| Premium document email via existing Resend | Implemented; configuration/provider delivery unverified |
