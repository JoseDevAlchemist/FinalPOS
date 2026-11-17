# Phase 7 file inventory

Scoped to this phase; other uncommitted repository files predate this work.
Created/modified describes the phase, independent of Git tracking status.

## Created

- [supabase/migrations/20261117080000_pos_mpesa.sql](../supabase/migrations/20261117080000_pos_mpesa.sql)
- [supabase/migrations/20261117081000_mpesa_snapshot_finalization.sql](../supabase/migrations/20261117081000_mpesa_snapshot_finalization.sql)
- [supabase/tests/pos_mpesa.test.sql](../supabase/tests/pos_mpesa.test.sql)
- [lib/mpesa/client.ts](../lib/mpesa/client.ts)
- [lib/mpesa/actions.ts](../lib/mpesa/actions.ts)
- [lib/mpesa/http.ts](../lib/mpesa/http.ts)
- [lib/mpesa/service.ts](../lib/mpesa/service.ts)
- [lib/validation/mpesa.ts](../lib/validation/mpesa.ts)
- [lib/sales/receipt.ts](../lib/sales/receipt.ts)
- [app/api/mpesa/stk-push/route.ts](../app/api/mpesa/stk-push/route.ts)
- [app/api/mpesa/callback/route.ts](../app/api/mpesa/callback/route.ts)
- [app/api/mpesa/status/route.ts](../app/api/mpesa/status/route.ts)
- [app/api/mpesa/manual/route.ts](../app/api/mpesa/manual/route.ts)
- [components/pos/checkout-dialog.tsx](../components/pos/checkout-dialog.tsx)
- [scripts/test-mpesa-local.mjs](../scripts/test-mpesa-local.mjs)

## Modified

- [components/pos/pos-terminal.tsx](../components/pos/pos-terminal.tsx)
- [components/pos/receipt.tsx](../components/pos/receipt.tsx)
- [lib/validation/sales.ts](../lib/validation/sales.ts)
- [lib/payments/mpesa.ts](../lib/payments/mpesa.ts)
- [lib/payments/actions.ts](../lib/payments/actions.ts)
- [app/api/pos/mpesa/callback/route.ts](../app/api/pos/mpesa/callback/route.ts)
- [supabase/tests/pos_record_sale.test.sql](../supabase/tests/pos_record_sale.test.sql)
- [next.config.ts](../next.config.ts)
- [eslint.config.mjs](../eslint.config.mjs)
- [package.json](../package.json)
- [.env.example](../.env.example)
- [.gitignore](../.gitignore)
- [architecture.md](../architecture.md)
- [database-contract.md](../database-contract.md)
- [features.md](../features.md)
- [testing.md](../testing.md)
- [progress.md](../progress.md)

This inventory itself is new: `docs/phase-7-files.md`.

## Manual acceptance

Use local Supabase. Configure server-only M-Pesa variables from `.env.example`,
including the callback secret and a reachable HTTPS callback URL. Mock tests
used fake credentials; real Safaricom connectivity remains unverified.

1. Add a product, open Charge, select M-Pesa, and enter a Kenyan phone number.
2. Initiate once; confirm PIN-waiting state and unchanged stock/unpaid sale.
3. Confirm a verified callback produces one sale, stock movement and M-Pesa receipt.
4. Check cancellation/decline permits retry; timeout alone must not imply decline.
5. Save a manual code after timeout: it must remain unverified and block a conflicting charge.

Browser automation is flaky/deferred at user request. Separate C2B validation/
confirmation endpoints are not implemented; payment notification handling here
is the STK callback. No further phase work has started.
