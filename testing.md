# Testing — Pedigree POS 2.0

**Status:** Cash and Phase 4 management tested locally with 75 pgTAP checks and
seven Playwright tests. The live database has not been touched. Physical hardware
verification remains pending.

## 1. Strategy

| Layer | Tool | What it must prove |
| --- | --- | --- |
| Unit | Vitest | Money/rounding, cart rules, validation schemas, time formatting, pure domain logic. |
| Component | Vitest + React Testing Library | Cart interactions, checkout states, error/empty/loading states, accessibility basics. |
| Integration | Vitest + local Supabase / route handler tests | Server actions and route handlers: auth required, Zod rejection, idempotency, provider stubs. |
| Database | Supabase pgTAP (`supabase/tests/`) | RLS: anon denied, cashier scoped, manager allowed, disabled staff denied; RPC authorisation and replay safety. |
| E2E | Playwright | Sign-in, sell for cash, scan, receipt, manager product/stock/return, offline gate. |
| Manual hardware | Device checklist | VFD connect/reconnect/messages, scanner, 80mm print. Cannot be fully automated. |

## 2. Required database cases

- `anon` cannot read `pos_users`, sales, returns, payments, movements or audit.
- Cashier cannot read another cashier's restricted history or write catalogue.
- Manager can perform authorised actions; disabled manager cannot.
- `pos_record_sale_v2` replay with the same `client_uuid` creates exactly one
  sale and one stock decrement.
- Concurrent sale of the last unit: one succeeds, one fails cleanly.
- Return cannot exceed sold/returnable quantity; concurrent over-return blocked.
- M-Pesa callback replay is applied once; wrong amount/reference rejected.
- Public product projection does not expose POS barcodes.

## 3. Quality gates

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

Current automated suites (local Supabase and a running dev server required):

```bash
pnpm test:e2e
pnpm test:rls
```

The unit/component stack and `pnpm test` are not configured yet.

## 4. Current results (2026-11-11)

| Check | Result | Notes |
| --- | --- | --- |
| `pnpm lint` | Passed | ESLint completed with no findings. |
| `pnpm exec tsc --noEmit` | Passed | Strict typecheck clean. |
| `pnpm build` | Passed | Next.js 16.4.6 production build. `/login` static; `/pos` and `/manager` partial-prerender behind session guards; both auth route handlers dynamic; Proxy registered. |
| `supabase db reset` | Passed | Local stack; three migrations applied and seed loaded. |
| `pnpm auth:link --dry-run` | Passed | Two intended links, no writes. |
| `pnpm auth:link` | Passed | Two Auth users created and linked. |
| Re-run `pnpm auth:link` | Passed | Both rows skipped; idempotent. |
| PIN login correct | Passed | Cashier `1234` and manager `4826` returned `200` with an HttpOnly `SameSite=Lax` session cookie. |
| `/pos` and `/manager` role routing | Passed | Cashier `/pos` rendered; cashier `/manager` streamed redirect to `/pos` with no manager content; manager `/manager` rendered. |
| Sign-out | Passed | `303` to `/login`; subsequent `/pos` redirected to login. |
| Wrong PIN | Passed | `401 invalid_pin`, no cookie. |
| Unlinked staff | Passed | `403 staff_not_linked`. |
| Inactive staff | Passed | `401 invalid_pin`; inactive row not matched. |
| Rate limit | Passed | Fifth and sixth attempts returned `429` with `Retry-After: 30`. |
| RLS anon | Passed | `401` permission denied on `pos_users`. |
| RLS cashier | Passed | Safe columns returned only own row; `pin_hash` returned `403`. |
| RLS manager | Passed | Roster returned both staff rows. |
| Unit / component tests | Not run | No test stack installed. |
| pgTAP / committed RLS tests | Not run | Manual local verification only. |
| E2E | Not run | No Playwright stack. |
| Hardware | Not tested | Requires physical devices. |

### Local reproduction

The environment used Podman’s Docker-compatible API because Docker was not
installed:

```bash
podman system service --time=0 &
export DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock
supabase start -x studio,realtime,storage-api,imgproxy,mailpit,postgres-meta,edge-runtime,logflare,vector,supavisor
supabase db reset
pnpm auth:link --dry-run
pnpm auth:link
pnpm build && pnpm start -p 3100
```

Then sign in with `1234` (cashier) or `4826` (manager). These are local seed
credentials only. On a machine with Docker, omit the Podman setup and the
`-x` exclusions as appropriate.

### Still required before trusting live

- Apply the migrations to a disposable copy of the shared schema and diff the
  result.
- Confirm the old POS is retired or accepts losing `anon` roster reads.
- Run the same login/RLS checks against the linked shared project.
- Commit pgTAP tests for `pos_users` RLS and an automated login E2E test.
- Verify no `pin_hash` appears in any browser response on the live project.

## 5. Limitations to document honestly

- Browser print on continuous roll depends on driver/paper settings; the app can
  isolate content and set `@page`, not guarantee the roll.
- Web Serial requires a Chromium-class browser and a user gesture; unsupported
  browsers must degrade gracefully.
- M-Pesa cannot be tested against production without authorisation; use the
  Daraja sandbox and recorded provider fixtures.
- The live shared schema is unverified until Phase 2; any test using a guessed
  schema is not evidence about production.

## Phase 3 checks — 2026-11-16

- `pnpm lint`: passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed after final dialog/validation adjustments.
- Existing local Supabase containers started without reset or migrations.
- Read-only local `pg_proc` query: no public functions with names containing `sale`.
- Full cash sale, retry/stock ledger verification, browser print output, and physical scanner/printer: not verified. Missing local sale RPC blocks the complete flow. No live services were accessed.

## Phase 3 completed verification — 2026-11-16

The earlier missing-RPC note is superseded by migration
`20261116100000_pos_sale_rpc.sql` and the following completed run.

| Check | Result |
| --- | --- |
| Local reset and seed | Passed; all six migrations applied |
| Staff provisioning | Passed; both local staff linked |
| pgTAP sale authorization and atomicity | 40 passed |
| Playwright cash flow and concurrency | 3 passed |
| Lint / TypeScript / production build | Passed |
| Physical scanner / thermal printer | Not tested |

The browser test uses the visible PIN keypad, keyboard-wedge scan events,
category chips and cash checkout. It drops an action response after commit,
retries, and confirms one sale/line/audit event and one product stock decrement.
It invokes the print button, asserts print-media isolation and 80mm receipt
width, and exports a one-page PDF. Two further tests verify concurrent UUID
replay and competing purchases of the last unit. The latter also verifies
client and SQL agreement on rounding a half-KES discounted price.

The SQL suite checks price/total tampering, cash, quantity bounds, invalid
colours, spoofed/disabled staff, anon execution denial, audit permissions,
transaction rollback, duplicate cart-line overselling, replay, ledger counts
and aggregate product/colour stock consistency including restocking. It runs
inside a rolled-back transaction.

Reproduce with the existing local stack (Podman socket required on this machine):

```bash
export DOCKER_HOST=unix:///run/user/1000/podman/podman.sock
npx supabase db reset --local
pnpm auth:link
npx supabase test db --local
pnpm exec playwright install chromium
pnpm dev
# In a second terminal:
pnpm test:e2e
```

The E2E suite refuses non-local Supabase URLs. It commits local cash sales and
keeps their records. If seed stock runs low, setup replenishes it through the
manager RPC with a test reason. Concurrency fixtures are hidden after tests.
Artifacts: `test-results/*/receipt.png` and `receipt-80mm.pdf` (gitignored).
The PDF was confirmed as one page, 227.04 × 841.92 points (80 × 297mm), with
only receipt content. Real paper size/cutting and a physical scanner still
require device checks.

## Receipt/search follow-up — 2026-11-16

- Build, lint and strict TypeScript checks passed.
- Targeted local browser test passed: partial query + Enter/Find leaves the cart
  unchanged; an exact barcode via Enter and exact name via Find each add an
  item; a subsequent scanner read adds automatically.
- The same test completed a cash sale and triggered the print button, asserted
  the receipt's print rectangle starts at x=0/y=0 with an 80mm width, and checked
  the centered, loaded logo is at most 120px wide.
- Visually inspected `test-results/*/print-layout.png`. `pdfinfo` confirmed the
  exported receipt is one 227.04 × 841.92 point page; `pdfimages` confirmed the
  logo is embedded. Physical printer testing remains pending.
- Retained the requested `80mm auto` page declaration alongside a valid fixed
  80mm fallback, since Chromium ignores the auto-height combination. Both are
  preserved in the production CSS. The dev server needed a fresh generated
  stylesheet before verifying the new print rules.

## Interactive colour picker — 2026-11-16

Build, lint and TypeScript checks passed. All four local E2E tests passed,
including the new selected-variant flow: radio selection by click/arrow key,
selection ring changes, separate Tan/Black cart lines, independent removal,
per-colour stock cap, and a cash sale persisting Black's id/name while leaving
Tan stock unchanged. Receipt focus stays on Print, the heading computes
`user-select: none`, and selected text is empty. Existing retry/concurrency and
80mm receipt-print checks also passed. Local fixture stock is replenished via
the audited manager RPC. No live database access or schema changes occurred.

## Phase 4 verification — 2026-11-17

- Quality gates: lint, strict TypeScript and production build passed.
- Local migrations applied incrementally with `migration up --local`; existing
  test sales and audit records were preserved.
- `npx supabase test db --local`: **75 passed** across cash (40) and management
  (35). Manager RPC tests cover privilege denial, audit privacy, private helper
  grants, idempotent creation/stock changes, rollback, active PIN uniqueness,
  fixed cashier roles, bcrypt storage and editing products after a sale without
  changing historical unit prices or colour stock.
- `pnpm test:e2e`: **7 passed**. Four cash/variant tests, two management flows and
  one image test. Product image coverage checks real image element loading,
  object-cover, source switching on colour change, broken-image fallback and
  recovery. Fixture URLs use existing local PNG/SVG assets rather than claiming
  they are real catalogue photographs.
- Management browser flow: manager PIN login → EAT overview → create a product
  with multiple colours/images and opening stock → +2/-1 adjustments → actor/
  reason/reference ledger checks and inventory history → verify new POS product
  and colour-specific photo. The staff flow verifies duplicate-PIN rejection,
  successful linked Auth enrollment, real PIN sign-in as the new cashier,
  manager-route denial, and navigation at 390px without horizontal overflow.
- Confirmed the installed Next.js action logger formats PIN-bearing FormData as
  `{}`. Manager-readable audit data and staff projections exclude PIN material.
- Screenshots reviewed: overview, product in POS and mobile staff form under
  `test-results/management-*`. Product fixtures are hidden and fixture cashiers
  disabled after tests; audit and sale evidence remains local.

Use the existing local stack and dev server, then run:

```bash
export DOCKER_HOST=unix:///run/user/1000/podman/podman.sock
npx supabase migration up --local
npx supabase test db --local
pnpm test:e2e
```

No production Auth users, shared schema, real payments or physical devices were
used in this verification. Returns/advanced reports and live compatibility are
not covered by the completed Phase 4 management scope.


## Phase 7 local verification

`pnpm test:mpesa` launches an isolated Next dev server and a local Daraja HTTP
mock with fake credentials. It refuses remote Supabase and never contacts
Safaricom. Tests exercise real Auth, routes, RPCs, database rows and checkout UI.
Server cases cover amount tampering, callback capability/metadata validation,
independent provider verification, UUID replay, decline, lost STK response,
early callback, unverified manual fallback, immutable price snapshots and
stock-race reconciliation. Browser checks target PIN waiting, 60-second timeout, manual-code persistence,
cash-conflict prevention and a confirmed receipt, but are flaky and deferred at
the user’s request. These UI outcomes require manual acceptance; they are not
claimed as passing.

The SQL suites pass **115 checks** across cash, management and M-Pesa. They
verify protected RPCs, owner-only polling, private callback/phone fields,
callback prerequisites, manual-code safety and exactly-once stock/audit writes.
Fixtures remain local; generated products are hidden after integration runs.
Actual Safaricom connectivity, credentials, public HTTPS callback delivery and
physical devices are not verified by mocks.

Final Phase 7 quality gates: `pnpm lint`, `pnpm exec tsc --noEmit`, and
`pnpm build` passed. Browser runs were stopped/deferred by user instruction.


Phase 5: lint, TypeScript and build passed; SQL total is now 125 checks (ten new
settings checks). A real local authenticated manager Supabase UPDATE to 132.75
was independently read back, including JSON projection, then restored. No
browser automation or live storefront refresh verification was performed.


Phase 6 simulated VFD check: `node tests/hardware/customer-display.test.mjs`
passed. Uses an in-memory fake serial display to verify serialized writes,
latest-wins pending frames, welcome and reconnection. It does not verify physical
transport, device protocol compatibility, browser chooser permissions or USB
scanner behavior. Those require manual hardware acceptance. Browser automation
remains deferred.

Phase 6 final quality gates: lint, TypeScript and production build passed,
including Turbopack resolution of the browser-only serial dependency.


## 2026-11-17 — Realtime web-order notifications

Added `supabase/tests/pos_realtime_orders.test.sql` with nine checks for publication
membership, RLS, SELECT grants, restrictive policy, active-cashier visibility,
disabled-staff denial, nonstaff identity isolation and no new anonymous policy.
It creates a transactional order fixture matching current storefront migrations
003/006; it requires that storefront schema and the new migration first.
The SQL suite was not run: sandboxed Podman access failed before connecting.
No local or shared migration was applied. Websocket/audio behavior is not claimed
as verified by compilation.

Manual acceptance: apply the reviewed migration in a suitable test project;
log in as cashier, check `Web orders: live`, interact once to enable audio, and
insert a pending_payment order through storefront checkout. Check the exact
order number/name/KES amount, chime, keyboard dismissal and persistence beyond
10 seconds amid cart toasts. Confirm updates/paid/cancelled inserts do not notify,
and two incoming orders both remain visible. Repeat as manager; disable the
linked staff account and verify further events cannot be read. Disconnect and
reconnect the network and check status recovery; do not expect missed INSERTs
to be replayed. Verify navigation/unmount removes subscriptions. Test without
Web Audio support and with autoplay blocked: visual alerts must still work.

Quality gates: `pnpm lint` and `pnpm exec tsc --noEmit` passed. Default
`pnpm build` hit a sandbox port-bind denial in the Turbopack CSS worker;
`pnpm build --webpack` passed compilation, Next.js TypeScript checks, all 25
page generations and build tracing. No source/configuration change was needed
for this fallback. The required Next.js feedback reporting command was attempted
once but could not check enablement without network access; sandbox policy does
not permit elevating network access in this session.


## 2026-11-17 — Expanded product management

Added `supabase/tests/pos_product_publishing.test.sql` for published/draft
creation, immutable replay payloads, public visibility, edits/unpublish, stock
preservation, positive/negative adjustment audit, retry safety, rollback,
manager/cashier/anonymous/disabled-manager authorization and private trigger
execution. The existing management browser scenario now creates a published bag
with preset multi-select colours, adjusts stock twice, checks pos_stock_adjustments,
unpublishes/republishes through the editor, checks anonymous database visibility,
and confirms product stock/images in the till.

Runtime verification is blocked in this sandbox: local Auth health fetch returns
EPERM, Podman cannot access its read-only runtime directory, and Next start
cannot bind a loopback port (listen EPERM). The local environment points at a
local Supabase URL, but no connection succeeded. Therefore the new migration,
SQL tests and browser scenario were not executed; no product was created or
stock changed during this task. Neither a green build nor a source review proves
the shared migration or rendered storefront sync works. Storefront page-cache
invalidation remains a separate integration requirement.

Final gates: `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build --webpack`
passed. The first webpack attempt failed parsing empty TypeScript --showConfig
output. Direct --showConfig output was valid JSON; one retry passed without
configuration changes, including all 25 generated pages. These are compilation
checks; the integration tests above remain unrun.


## 2026-11-17 — Returns and refunds

Executed `node --experimental-strip-types tests/returns/refund.test.mjs`: all four
checks passed. Covers integer rounding across partial returns, original discount
budgets/zero refunds, invalid quantities and large integer multiplication.
Node emits its module-type warning when importing the TypeScript helper; no
package/module configuration change was needed.

Added `supabase/tests/pos_returns.test.sql` with 39 pgTAP checks. Covers manager,
cashier, anonymous and disabled-manager permissions; private allocation helper;
revoked direct writes; historical discounted refund amounts despite changed
catalogue prices; colour/product restock and ledger references; matching retry;
changed-payload rejection; over-return caps; mixed/foreign item rollback; unpaid
sales; zero/duplicate quantities; missing original colours; cumulative partial
rounding; full refund exactly equal to paid total; and unchanged original amounts.
`pnpm test:rls` was attempted but Supabase CLI failed writing telemetry into a
read-only home directory before connecting. SQL checks were not executed and the
migration was not applied. Prior local container/network sandbox restrictions
also remain unresolved; no live database was contacted.

Added `tests/e2e/returns.spec.ts` for a local manager login → receipt search →
partial return → lost action-response retry → same refund/stock result → receipt
focus/80mm print media/reprint → two concurrent requests for the final unit,
where exactly one may succeed. It uses a local-only target guard and retains
financial history while hiding its catalogue fixture. This scenario was authored
and type-checked but not run in this environment. Database concurrency, RLS,
actual receipt rendering and physical printing remain pending acceptance.

Manual acceptance: apply reviewed migrations in a local/test project; complete a
paid two-colour sale; find its printed short receipt in Returns as a manager;
return one selected unit with a reason; compare both colour and products stock,
ledger reference, pos_returns header and item/refund rows. Confirm the other
colour is unchanged, original sale amounts are unchanged and the manual refund
receipt prints/reprints. Retry a lost response with the same request, then return
remaining units and verify cumulative refund equals the original total. Cashier,
anonymous and disabled-manager attempts must fail; unpaid, foreign, duplicated
and excessive quantities must leave stock/refund history unchanged.

Final returns quality gates: `pnpm lint`, `pnpm exec tsc --noEmit` and
`pnpm build --webpack` passed. The build includes /manager/returns with 26 page
generations. Runtime limits above still apply.


## 2026-11-17 — Cashier Manager PIN approval and digital documents

Executed:
`node --experimental-strip-types --import ./tests/digital/alias-loader.mjs tests/digital/documents.test.mjs`
All four tests passed: Kenyan/international phone normalization and WhatsApp
encoding; unique quote IDs and quotation/paid distinction; rendered premium
responsive markup with customer/cashier/brand/totals and no thermal classes;
escaped complete premium email HTML. The test-only Node hooks resolve the app's
TypeScript aliases and transform the pure TSX document component. This is static
HTML verification, not a browser screenshot or delivered email.

Added `supabase/tests/pos_digital_approval.test.sql` (37 assertions): quote/receipt
RLS and denied direct writes; server quote prices despite injected prices; no
inventory movements/reservations for quotes; preserved snapshots on retry after
repricing; original paid receipt totals/cashier; unpaid denial; staff lookup;
service-only approval; cashier/ambiguous legacy PIN denial; durable lockout; manager approval;
restored cashier/JWT identity; requester/approver audit; retry-safe restocking;
no PIN in saved payload; disabled manager/cashier denial. SQL execution remains
blocked in the sandbox; migrations were not applied.

Added `tests/e2e/digital-approval.spec.ts` for cashier login → Create Quote →
customer form → premium preview/WhatsApp link → unauthenticated token page and
wrong-token unavailable view/mobile width → mocked unconfigured email (no actual send) →
receipt lookup → cashier PIN rejected/Manager PIN accepted → cashier identity
preserved → sale success → premium digital receipt. Financial fixtures are kept
for audit and only hidden from the catalogue. Browser scenario is authored and
type-checked but not run because local server/database access remains restricted.

`pnpm test:rls` was attempted again; the Supabase CLI is blocked by its read-only
home-directory telemetry path before connecting. No PIN approval/refund, quote,
shared page request or provider email send was exercised against a running
backend. Manual acceptance must apply reviewed migrations, run the SQL/browser
suites, verify cashier cookies are unchanged after approval, exercise wrong PIN
lockout/retry, check original-colour/product stock and audit actors, verify quote
creation leaves stock unchanged, test links from a separate device/context, and
configure a verified email sender before testing provider acceptance/delivery.

Final quality gates passed: `pnpm lint`, `pnpm exec tsc --noEmit` and
`pnpm build --webpack` (27 page generations including the public document route).
The first webpack attempt hit the recurring empty --showConfig parse failure;
direct configuration output was valid JSON and retry passed. The required Next
feedback command could not check enablement without network access. Sandbox
policy does not permit a network escalation in this session.


## 2026-11-17 — Flutterwave card checkout

Seven executed mock tests passed:

- `node --experimental-strip-types --import ./tests/digital/alias-loader.mjs tests/flutterwave/verification.test.mjs`
  (five checks): successful status, exact ID/reference, currency and card method;
  underpayment rejection; overpayment acceptance/integer bounds; exclusion of
  provider card/token/customer metadata; validated request and reference recovery.
- `node --conditions=react-server --experimental-strip-types --import ./tests/digital/alias-loader.mjs tests/flutterwave/provider.test.mjs`
  (two checks): fixed HTTPS endpoint/server bearer secret/no caching/no redirects;
  reference-based recovery and HTTP failure. Network is stubbed; no provider was
  contacted and the key used by these tests is a temporary test-only process value.

Added pos_flutterwave.test.sql with 38 authorization/snapshot/stock/audit/replay/
reconciliation checks. Covers anonymous/disabled staff, denied direct card commits,
server preparation prices, stable references, prepared/pending cash locks,
uncancellable opened attempts, wrong reference/underpayment, unique evidence,
frozen prices after catalogue changes, exactly-once stock/audit, retained verified
funds after a stock race, manager ledger adjustment and same-capture completion,
and safe/idempotent cancellation of an unstarted draft.
`pnpm test:rls` was attempted but the CLI failed on its read-only telemetry path
before connecting. The SQL suite was not run and the migration was not applied.

Added tests/e2e/flutterwave.spec.ts: a mocked hosted modal asserts card/KES config,
real local draft preparation plus synthetic service evidence exercises the sale
RPC, the first verification response is lost, Check Card Status recovers the same
receipt, stock decrements once, historical price is preserved and print is called
once. The test stubs provider/verification transport and window.print, requires a
local Supabase target and configured test keys/rebuilt app, and retains financial
fixtures while hiding the catalogue entry. It is authored/type-checked but was
not run. This is not evidence of live provider verification, 3DS/OTP, delivery or
physical printing; those need separate sandbox/provider acceptance.

Manual acceptance: apply reviewed migrations locally/in a test project, add test
public/secret keys, rebuild, complete a cash baseline, then pay a two-colour cart
via Card using Flutterwave sandbox instruments only in the hosted window. Check
provider verified id/ref/amount/currency, original colour and products stock,
paid card sale/audit, receipt and print recovery. Test script-load failure before
opening; onclose during processing; lost callback/HTTP response; reload with an
empty cart and unresolved draft; lower expected_amount and foreign reference/ID;
provider decline/timeout; simultaneous cash/M-Pesa initiation; catalogue repricing;
and successful capture with depleted stock followed by audited stock resolution.
No raw card data should appear in application requests/storage/logs. Check that
no uncertain attempt can trigger a second charge or switch to cash automatically.

Final Card quality gates: `pnpm lint`, `pnpm exec tsc --noEmit` and
`pnpm build --webpack` passed (28 page generations). Seven mock tests passed;
SQL/browser/provider acceptance remains pending as recorded above.

## 2026-11-17 — Optional orders migration reset fix

The missing-orders branch now returns before every orders/publication/RLS setup
statement. Requested `npx supabase db reset` could not reach PostgreSQL because
npm registry DNS failed (EAI_AGAIN). Direct installed `supabase db reset` was also
attempted but CLI telemetry writing failed on the read-only home directory
(EROFS). Reset completion is not verified. Lint and TypeScript passed.

`pnpm build --webpack` also passed (28 page generations).


## 2026-11-17 — C2B confirmation and URL registration

Executed:
`node --conditions=react-server --experimental-strip-types --import ./tests/digital/alias-loader.mjs tests/mpesa/c2b.test.mjs`
All eight tests passed: immediate accepted confirmation without external I/O;
redacted/stable transaction logs and decimal text; malformed request denial and
validation acknowledgement; correct base/STK URL normalization; OAuth then C2B
registration body/headers; dry run and production guard; provider rejection; and
terminal error redaction. Fetch is mocked and no actual payment is initiated.

The real `node --experimental-strip-types scripts/register-mpesa-urls.ts` command
was attempted with the fresh configuration. It failed with EAI_AGAIN before OAuth.
The environment was confirmed as Sandbox and its callback path is the existing
/api/mpesa/callback, without printing the host or credentials. Registration did
not succeed and real credentials/provider callbacks were not verified.

The orders migration was re-read: its missing-table branch already raises a
notice and returns before publication/grants/policies. `npx supabase db reset`
was retried with bounded npm retries but failed on registry DNS. The installed
CLI was retried with SUPABASE_HOME=/tmp/pos-supabase-cli, telemetry disabled and
DO_NOT_TRACK=1. This bypassed the previous telemetry failure and targeted local
127.0.0.1:54322, but service inspection then failed because Podman cannot update
its read-only runtime directory. Reset never reached migrations. No live database
or payment was touched.

After applying/resetting the reviewed schema on a host with runtime access, run
`pnpm mpesa:register-urls --dry-run` to inspect paths, then
`pnpm mpesa:register-urls` with Sandbox credentials and the appropriate C2B
shortcode. Ensure the Ngrok host forwards these POST endpoints, then use Safaricom
Sandbox C2B simulation to verify Accepted response and redacted observation logs.
This logging-only handler must not create a paid POS receipt or change stock.
STK Push remains on /api/mpesa/callback with its existing independent checks.

Primary registration request reference:
https://github.com/safaricom/mpesa-api-C-Sharp/blob/master/C2BRegUrlsApi.cs

Final C2B quality gates: `pnpm lint`, `pnpm exec tsc --noEmit`, and
`pnpm build --webpack` passed (30 page generations, both C2B endpoints included).
Eight mock/handler tests passed. Local reset and real registration remain blocked
as documented above; neither was reported as successful.


## 2026-11-17 — Registration environment loading

The package command now uses --env-file=.env.local; direct execution loads the
file relative to the script and fails on loading errors. Nine mocked/handler
C2B tests passed, including credential absence/blank checks and OAuth header
construction from trimmed loaded values. `pnpm mpesa:register-urls` was executed
but failed with EAI_AGAIN before a Safaricom response. No HTTP 401 was reproduced
or resolved against the provider and no registration success is claimed.

Environment-loading final gates: lint, TypeScript and webpack build all passed
(30 page generations). Registration remains unverified because of DNS failure.

## 2026-11-17 — OAuth diagnostics

Ten C2B tests passed, including diagnostics redaction, stable header fingerprint,
header length and exclusion of full key/secret/Base64. Mock HTTP verifies that
fetch still receives the real Basic header. The actual registration command
printed the Sandbox URL, key prefix and lengths, then failed on DNS (EAI_AGAIN)
before a provider response; no HTTP 401 or registration success was observed.
Lint and TypeScript passed; credentials were not changed or fully printed.

OAuth diagnostics final gates: lint, TypeScript and webpack build all passed
(30 page generations); ten C2B/registration tests passed.
