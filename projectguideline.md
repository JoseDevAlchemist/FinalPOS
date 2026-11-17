# Project Guideline — Pedigree POS 2.0

## 1. Vision

A reliable, secure, online-first point of sale and retail management system for
Pedigree Leather, Nairobi. It replaces the previous offline-first POS with a
central, auditable system that shares products, inventory and orders with the
existing Pedigree Leather e-commerce storefront.

The product should feel like the brand: warm cream, espresso brown, muted gold,
elegant typography and calm, uncluttered screens built for a busy till.

## 2. Business requirements

- Sell leather goods in KES at a desktop till, quickly and without ambiguity.
- Accept cash, verified M-Pesa (Daraja STK Push) and an external card terminal
  reference.
- Keep one authoritative stock count shared with the website.
- Give managers control of products, stock, staff, returns, exchange rate and
  reporting.
- Give cashiers a focused terminal with only the permissions they need.
- Print 80mm thermal receipts and show totals on a customer VFD when attached.
- Notify staff of confirmed website orders.
- Every financial action must be traceable to a staff member and safe to retry.

## 3. Hard constraints

1. Supabase PostgreSQL is authoritative. Browser storage never holds money,
   stock, roles or PIN hashes.
2. The app is online-first. Checkout is disabled when the server is unreachable;
   no sale is queued locally.
3. No Dexie, IndexedDB sale queue, `sync_queue`, PWA outbox or local PIN hash
   distribution.
4. Server calculates prices, discounts and totals. Client values are untrusted.
5. Every sale, return and payment attempt is idempotent via a client UUID.
6. Stock changes are ledger entries with actor, reason, time and reference.
7. RLS plus server-side authorisation is mandatory; `anon` is untrusted.
8. The service-role key and Daraja secrets never reach the browser or logs.
9. Hardware is optional: VFD, scanner or printer failure cannot block or lose a
   committed sale.
10. M-Pesa is never shown as paid before the callback is validated and persisted.
11. Shared schema changes are additive, reviewed and coordinated with the
    storefront.
12. The old POS at `/home/jose/Desktop/Projects/PedigreePOS` is read-only.

## 4. Scope for the first production version

### In scope

- Staff auth (manager/cashier), protected routes, session expiry.
- Product browsing/search/scan and cart.
- Cash checkout, M-Pesa STK Push, external card reference.
- Server-confirmed sales, receipts, reprints.
- Manager dashboard, products, inventory ledger, staff, sales, returns, reports.
- Central KES/USD exchange rate with audit history.
- Shared stock with the storefront, order notifications.
- VFD, scanner and 80mm print support plus simulators.
- Connectivity indicator and safe failure states.

### Deferred

- Offline selling / local transaction queues.
- Loyalty programmes.
- Multi-branch support (unless the live schema forces it).
- Native card acquiring.
- Supplier/warehouse logistics.
- Device enrolment and offline assertions.

## 5. Technology

Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS v4, Lucide,
Framer Motion, Supabase Postgres/Auth/Storage/Realtime, `@supabase/ssr`,
Server Components/Actions, Route Handlers, Postgres RPCs, Web Serial, keyboard
scanner input, browser print, Safaricom Daraja.

Testing: Vitest + React Testing Library for units/components, Playwright for E2E,
Supabase pgTAP for RLS/RPC authorisation. Exact packages are chosen in Phase 1–2
and recorded in `testing.md`.

## 6. Application structure

```
app/          login, pos, manager/*, api/*
components/   auth, pos, manager, products, payments, receipts,
              hardware, shared, ui
lib/          supabase, auth, products, inventory, sales, payments,
              currency, reporting, hardware, validation
supabase/     migrations, tests
types/        generated DB types, shared domain types
tests/        unit, integration, e2e
docs/         supporting documents
```

Server Components by default. Business rules live in `lib/<domain>`, not in
components. SQL owns transactional atomicity.

## 7. Design system

- Warm ivory/cream page surfaces; espresso brown chrome; muted gold accents.
- Semantic Tailwind tokens only (`bg-primary`, `text-muted`, `border-border`,
  `shadow-card`); raw hex belongs in `app/globals.css`.
- Manrope for UI, Cormorant Garamond for display headings.
- Desktop-first for 1366×768 and above, with responsive tablet support.
- Rounded cards, warm shadows, subtler borders, restrained motion.
- Accessible focus, labels, contrast, keyboard paths and reduced motion.

## 8. Integration constraints

- The storefront owns `products`, colour/image tables, orders and settings.
  Confirm the live schema before any migration; see `database-contract.md`.
- POS barcodes must never be exposed to public storefront queries.
- The exchange rate must have one shared source and preserve historical sale
  amounts.
- Website order notifications must use the storefront's real payment statuses.
- Any shared migration requires a storefront regression test.

## 9. Working method

Build in the phase order in `progress.md`. Keep the app buildable. Validate
externally sourced data with Zod. Update documentation when contracts change.
Never claim a feature is working without evidence. Do not touch live
infrastructure or the old POS without explicit authorisation.
