Welcome to Pedigree POS 2.0. 

This is a brand new Next.js project located at `/home/jose/Desktop/Projects/PedigreePOS-v2`. We are building the modern, online-first version of our POS.

**YOUR RULES:**
1. The OLD POS exists at `/home/jose/Desktop/Projects/PedigreePOS`. You may read it to copy the exact visual design (Tailwind colors, layout, fonts) and the hardware integration code (Web Serial VFD, Barcode Scanner). 
2. You must NOT copy the old offline-first architecture (Dexie, sync_queue). This new app is strictly Online-First. Supabase is the authoritative database.

**YOUR IMMEDIATE TASKS (PHASE 0 ONLY):**
Do NOT write any React page components yet. Do NOT build the database schema yet. 

Your job right now is to:
1. Read the Master Specification pasted below.
2. Read the old project's files to understand the design and hardware:
   - `/home/jose/Desktop/Projects/PedigreePOS/app/globals.css` (copy the design tokens/colors from here).
   - `/home/jose/Desktop/Projects/PedigreePOS/lib/customer-display.ts` (understand the VFD logic).
3. Create the following documentation files in this new project:
   - `AGENTS.md` (Development instructions, coding conventions)
   - `architecture.md` (System architecture, data flows for the new Online-First model)
   - `database-contract.md` (The expected Supabase tables, RLS, and RPCs. Remember: we are sharing this database with the old POS and the website).
   - `progress.md` (Initialize this. Mark Phase 0 as "In Progress").
4. Update `app/globals.css` in the new project with the Tailwind v4 design tokens from the old project (Warm ivory, espresso browns, gold accents).
5. Set up the `lib/supabase/client.ts` and `lib/supabase/server.ts` files using the `@supabase/ssr` package for secure server-side auth.

Once you have generated these docs and the base setup, stop and wait for my approval before starting Phase 1 (Authentication).

---

**MASTER SPECIFICATION:**

# PEDIGREE POS 2.0 — MASTER DEVELOPMENT SPECIFICATION

## ROLE AND MISSION

You are the Principal Software Architect, Senior Full-Stack Developer, Database Engineer, Security Engineer, UI/UX Designer, and QA Engineer responsible for building **Pedigree POS 2.0**.

Your assignment is to develop a modern, secure, production-quality, web-based Point of Sale and Retail Management System for **Pedigree Leather**, a leather goods business in Nairobi, Kenya.

This is a brand-new Next.js project.

You are building a new application, not refactoring or copying the old POS.

You have authority to design the architecture, write application code, build components, develop tests, create documentation, and configure local development infrastructure.

You must not change the live Supabase schema, deploy, initiate real payments, or perform destructive external operations without explicit authorization.

The objective is to build a reliable retail system that integrates seamlessly with the existing Pedigree Leather e-commerce website.

---

# PART I — DEVELOPMENT PHILOSOPHY

## 1. Core Principles

Build the application around these principles:

1. Supabase PostgreSQL is the authoritative operational database.
2. The application is web-first and requires central confirmation for financial transactions.
3. Every sale must be durable, auditable, and protected against duplicates.
4. Product inventory is shared with the e-commerce website.
5. Currency configuration is centrally managed.
6. Server-side authorization is mandatory.
7. Cashiers and managers have different permissions.
8. Payment status must be verified rather than assumed.
9. Customer-facing hardware must not prevent normal POS operation if disconnected.
10. The interface must be fast, readable, attractive, and optimized for desktop retail use.
11. Financial records must never depend solely on browser storage.
12. Every feature must have appropriate validation and error handling.
13. Database migrations must be versioned and backward-compatible where possible.
14. The old POS should remain untouched and available for historical reference.
15. Do not invent completed integrations or unverified hardware capabilities.

## 2. Explicitly Deferred Features

Do not implement the old offline-first synchronization architecture.

For the first production version, exclude:

- Dexie as the primary operational database.
- Local-only financial transactions.
- Unverified offline sales.
- Complex browser-to-cloud outbox synchronization.
- Browser-local staff PIN hash distribution.
- Automatic migration of old POS code.
- Advanced customer loyalty programmes.
- Multi-branch support unless the existing database requires it.
- Native card acquiring infrastructure.
- Complex supplier and warehouse logistics.

However, provide an offline connection indicator and friendly recovery UI.

If the application loses access to Supabase, disable transaction completion and clearly inform the cashier.

Future offline selling can be designed as a separate feature after the online system is proven reliable.

---

# PART II — TECHNOLOGY STACK

## 3. Required Technologies

Use the following stack:

### Frontend

- Next.js App Router
- React
- TypeScript with strict checking
- Tailwind CSS v4
- Lucide React
- Framer Motion where animations add value

### Backend

- Next.js Route Handlers or Server Actions where appropriate
- Supabase PostgreSQL
- Supabase Auth
- PostgreSQL functions for transactional operations
- Row Level Security
- Supabase Realtime when appropriate

### Hardware

- Web Serial API where supported
- Keyboard-wedge barcode scanner integration
- Browser-based thermal receipt printing

### Payments

- Safaricom Daraja M-Pesa STK Push
- Cash transaction processing
- External card terminal reference recording

### Testing

Choose appropriate automated testing tools for:

- Unit testing
- React component testing
- API integration tests
- Database authorization tests
- End-to-end browser tests

Use current stable, mutually compatible dependency versions.

Do not blindly reuse outdated dependencies from the previous POS.

---

# PART III — APPLICATION STRUCTURE

## 4. Suggested Architecture

Organize the project using domain-oriented boundaries.

Suggested structure:

app/
- login/
- pos/
- manager/
- manager/products/
- manager/inventory/
- manager/staff/
- manager/sales/
- manager/returns/
- manager/settings/
- manager/reports/
- api/

components/
- auth/
- pos/
- manager/
- products/
- payments/
- receipts/
- hardware/
- shared/
- ui/

lib/
- supabase/
- auth/
- products/
- inventory/
- sales/
- payments/
- currency/
- reporting/
- hardware/
- validation/

supabase/
- migrations/
- tests/

types/
tests/
docs/

Treat this as a starting point, not a requirement to create unnecessary files.

Separate business logic, database access, hardware communication and presentation components.

Use shared schemas and type-safe interfaces.

---

# PART IV — DESIGN SYSTEM

## 5. Visual Identity

The interface must feel like a premium leather goods retail application.

Use a refined visual identity:

- Warm ivory and cream backgrounds.
- Rich espresso and chocolate-brown primary colors.
- Muted gold accents.
- Subtle borders.
- Soft shadows.
- Rounded cards.
- Elegant typography.
- Comfortable spacing.
- Clean navigation.
- Restrained transitions.

The existing Pedigree POS screenshot may be used as a visual reference if supplied.

Do not copy the old architecture.

### Layout

The application is desktop-first.

Target common retail monitor sizes, including 1366 × 768 and larger screens.

Provide responsive support for tablets and smaller screens.

Avoid horizontal overflow, crowded navigation, excessively small controls, or unnecessary scrolling.

### Accessibility

- Keyboard navigation.
- Visible focus states.
- Accessible labels.
- Appropriate contrast.
- Reduced-motion support.
- Recoverable error messages.
- Large, easily clickable checkout buttons.

---

# PART V — AUTHENTICATION

## 6. Staff Accounts and Permissions

Implement a trustworthy authentication system.

Support two primary roles:

### Manager

Can:

- Access management dashboards.
- Create and edit products.
- Assign barcodes.
- Manage inventory.
- View all authorized sales.
- Approve and process returns.
- Manage employees.
- Change exchange rates.
- Access financial reports.
- Review relevant audit logs.

### Cashier

Can:

- Access the sales terminal.
- Browse and search products.
- Scan barcodes.
- Manage the shopping cart.
- Process authorized sales.
- Print receipts.
- View their permitted transaction history.
- Request manager approval for restricted actions.

### Security

Use Supabase Auth or an equivalent secure server-managed staff identity system.

If using four-digit PINs, require device-aware enrollment and secure server verification, rate limits, session expiry, and revocation.

Never expose staff PIN hashes through anonymous product or roster queries.

Never trust client-submitted roles as proof of authorization.

RLS and server-side permissions must enforce access boundaries.

Provide sign-in, sign-out, session expiry, disabled-user handling and account recovery procedures.

---

# PART VI — SALES TERMINAL

## 7. Main POS Screen

Develop a full-featured sales interface.

### Product Catalogue

Display products using attractive cards containing:

- Product image.
- Product name.
- Product category.
- Price in KES.
- Available stock.
- Relevant variation information.

### Product Search

Allow searching by:

- Name.
- Category.
- Barcode.
- SKU.
- Other supported internal identifiers.

Support category filters and efficient product loading.

### Shopping Cart

Implement:

- Add product.
- Remove product.
- Increase quantity.
- Decrease quantity.
- Clear cart.
- Display unit prices.
- Display line totals.
- Display subtotal.
- Apply authorized discounts.
- Display final payable amount.

Prevent impossible quantities and invalid totals.

### Checkout

Provide payment methods:

1. Cash.
2. M-Pesa.
3. External card terminal.

Use server-side pricing validation.

Do not assume the client cart contains authoritative prices or inventory.

A completed sale must be committed centrally and reflected in inventory.

Use idempotency keys to prevent duplicate transactions.

---

# PART VII — PRODUCT MANAGEMENT

## 8. Product Creation and Editing

Managers must be able to create and edit products.

Required fields:

- Product name.
- Description.
- Category.
- KES base price.
- Discount.
- Current stock information.
- Product images.
- Product colors.
- Barcode.
- Internal SKU.
- Active status.
- Website publication status.

Preserve compatibility with the existing e-commerce product model.

### Images

Support product-image upload through authorized Supabase Storage workflows.

Validate file types and sizes.

Provide loading, upload progress, error and retry states.

### Inventory

Do not overwrite stock without an audit trail.

Use authorized stock adjustments, with reasons, timestamps and actor identity.

Support opening stock, stock receiving, corrections and return-related movements.

---

# PART VIII — BARCODE SYSTEM

## 9. Barcode Management

Support conventional USB keyboard-wedge barcode scanners.

Scanning should resolve the product and add it to the cart.

Requirements:

- Assign existing barcodes.
- Generate unique internal barcodes where appropriate.
- Prevent duplicates.
- Edit barcode assignments.
- Search using barcodes.
- Support repeated scans.
- Provide sound or visual feedback.
- Handle unknown barcodes.
- Print barcode labels.
- Support scanner-friendly focus behaviour.

Separate barcodes from QR codes where necessary.

### Barcode Privacy

Product barcodes and internal identifiers must remain private to authorized POS users.

The e-commerce website must not display or expose private POS barcodes through public database queries.

Use secure database projections, authorization policies, or a dedicated internal identifier model.

Do not rely only on hiding fields in frontend components.

Coordinate any shared schema changes with the website.

---

# PART IX — CUSTOMER DISPLAY

## 10. Secondary Customer LED/VFD Display

The physical POS has an additional customer-facing display.

Build a hardware service for compatible displays.

Investigate the device protocol before assuming its capabilities.

Support:

- Connect.
- Disconnect.
- Reconnect.
- Connection status.
- Device selection.
- Unsupported-browser handling.
- Serial write errors.
- Controlled message updates.
- Safe operation if the display is unavailable.

### Display Content

When idle:

WELCOME TO
PEDIGREE

When adding products:

Show the latest item or an appropriate abbreviated name.

Display the transaction total.

During checkout:

Show payable amount.

For cash:

Show cash received and change where supported.

For M-Pesa:

Show appropriate payment-pending and confirmation messages.

Never show payment success until verified.

Adapt all messages to actual hardware dimensions.

If the hardware is unavailable during development, provide a display simulator for testing.

Do not assume that a customer-facing VFD can physically charge a customer.

---

# PART X — THERMAL RECEIPTS

## 11. Receipt System

Create a dedicated thermal receipt renderer.

Support common 80mm thermal paper, with configurable 58mm support if required.

### Receipt Fields

Include:

- Business name and optional logo.
- Receipt number.
- Transaction date and time in East Africa Time.
- Cashier identity or staff identifier.
- Product names.
- Quantity.
- Unit price.
- Line totals.
- Discounts.
- Total payable.
- Payment method.
- Amount received and change when applicable.
- Verified payment reference when applicable.
- Short thank-you message.

### Printing

Receipts must:

- Start at the top.
- Avoid unnecessary white space.
- Print only receipt content.
- Hide application navigation and dialogs.
- Avoid extra pages.
- Prevent content clipping.
- Respect thermal printer capabilities.

Implement appropriate print CSS and isolated print content.

Where continuous-roll behaviour depends on browser, driver, or hardware configuration, document the limitation.

Support receipt reprinting from historical transactions with an appropriate reprint indicator.

---

# PART XI — CENTRAL CURRENCY MANAGEMENT

## 12. KES/USD Exchange Rate

The POS and website use KES and USD pricing.

Create or integrate a centrally managed exchange-rate configuration.

The manager sets:

1 USD = X KES

Automatically calculate eligible USD product prices from KES base prices.

Example:

KES 13,000 / 130 = USD 100.00.

When the manager changes the rate, both the POS and website should use the updated value.

Requirements:

- Authorized updates only.
- Audit history.
- Input validation.
- Decimal-safe calculations.
- Consistent rounding.
- Shared database source.
- Realtime invalidation or reliable refresh.
- Historical sale amount preservation.
- No repricing of completed transactions.

Review existing website pricing overrides before deciding how to migrate them.

Do not remove existing USD price fields until compatibility has been established.

---

# PART XII — M-PESA PAYMENT PROCESSING

## 13. Safaricom Daraja STK Push

Implement a complete and verifiable M-Pesa payment lifecycle.

### Checkout Flow

1. Cashier selects M-Pesa.
2. Cashier enters the customer's phone number.
3. Phone number is validated and normalized.
4. Server creates a payment attempt.
5. Server initiates STK Push.
6. Customer receives the prompt.
7. Customer authorizes payment on their phone.
8. Safaricom sends the callback.
9. Server validates and correlates the result.
10. Verified payment is persisted.
11. POS receives confirmed status.
12. Sale is finalized exactly once.

### Required Payment States

- Created.
- Pending.
- Successful.
- Failed.
- Cancelled.
- Timed out.
- Requires reconciliation.

### Security

- Never expose consumer secrets or passkeys.
- Validate callback content.
- Prevent replay and duplicate processing.
- Verify transaction amount and merchant context.
- Enforce idempotency.
- Restrict initiation to authorized staff.
- Rate-limit sensitive endpoints.
- Store durable payment attempt records.
- Provide recovery for delayed callbacks.
- Avoid logging unnecessary personal data.

Use the applicable official Safaricom Daraja specification and merchant configuration.

Do not invent production credentials.

Keep cash, manually recorded card payments, and verified M-Pesa payments distinguishable.

---

# PART XIII — INVENTORY AND E-COMMERCE INTEGRATION

## 14. Shared Inventory

The POS and existing Pedigree Leather website share Supabase.

A product sold through either channel must affect the same authoritative inventory.

### Requirements

- Server-side atomic stock updates.
- Prevention of unauthorized overselling.
- Consistent product IDs.
- Accurate inventory counts.
- Idempotent sale processing.
- Centralized inventory movements.
- Safe returns and stock restoration.
- Realtime or refreshed inventory views.
- Reliable concurrency handling.

Do not create a separate unrelated product catalogue.

Do not duplicate the business's stock across disconnected tables.

### Website Compatibility

Before applying shared migrations:

1. Inspect the website's database contract where available.
2. Inspect the live schema through authorized tools.
3. Compare product and inventory columns.
4. Identify existing RPCs.
5. Review RLS policies.
6. Prepare backward-compatible migrations.
7. Test both POS and website workflows.

If the website repository is unavailable, document integration requirements rather than guessing its behaviour.

---

# PART XIV — MANAGER DASHBOARD

## 15. Manager Portal

Create a professional management dashboard.

### Overview

Show:

- Today's confirmed sales.
- Sales count.
- Bags sold.
- Shoes sold.
- Payment mix.
- Low-stock products.
- Recent transactions.
- Pending payment exceptions.
- Returns and refunds.

Reports should use central database records, not solely device-local data.

Use East Africa Time consistently.

### Management Pages

Build:

- Product management.
- Inventory adjustments.
- Staff management.
- Sales history.
- Returns and refunds.
- Payment records.
- Currency settings.
- Reports.
- Hardware settings where applicable.

### Sales History

Provide:

- Search.
- Date-range filters.
- Receipt lookup.
- Transaction details.
- Payment status.
- Cashier attribution.
- Reprint receipt.
- Authorized returns.

### Returns

Implement manager-controlled returns.

Validate original sale membership and returnable quantities.

Prevent repeated refunds or returns beyond the original quantity.

Use concurrency-safe database transactions.

Record refund method, amount, reason, timestamp and approving manager.

Do not claim an electronic refund was processed unless the provider confirms it.

---

# PART XV — WEB ORDER NOTIFICATIONS

## 16. Website Order Awareness

The POS should be aware of orders created through the e-commerce website.

Implement an authorized integration using the existing orders table or compatible order events.

When a new website order is confirmed:

- Notify relevant staff.
- Display a nonintrusive toast.
- Allow the manager to review details.
- Prevent duplicate notifications where possible.
- Make historical orders available after reconnection.

Do not treat every inserted draft order as paid.

Use the website's actual order and payment status model.

---

# PART XVI — ONLINE STATUS AND ERROR HANDLING

## 17. Connectivity Management

The application is web-first.

Show accurate connection status:

- Connected.
- Connecting.
- Disconnected.
- Server unavailable.
- Session expired.

When offline:

- Show "POS currently offline".
- Preserve safe nonfinancial interface state.
- Disable authoritative transaction completion.
- Do not queue unverified financial transactions.
- Explain that connectivity is required to finish a sale.

A browser refresh should restore centrally completed transaction history.

Add retry controls and graceful error recovery.

Never show "Synced" solely because there are zero locally pending actions.

---

# PART XVII — SECURITY AND QUALITY

## 18. Security Requirements

Implement:

- Secure staff authentication.
- Server-side authorization.
- RLS.
- Protected RPC operations.
- Validation of all external inputs.
- Server-calculated totals.
- Idempotent transactions.
- Role-based management.
- Safe media uploads.
- Rate limiting where appropriate.
- Appropriate session expiry.
- Privacy-aware logging.
- Audit records for sensitive actions.

Do not trust the browser to determine payment success, inventory availability or user privileges.

Review the old codebase audit findings if `codexreview.md` is supplied as reference material.

## 19. Reliability

Handle:

- Double-clicking checkout.
- Two cashiers selling the same last item.
- Connection loss during server commit.
- Duplicate payment callbacks.
- Expired staff sessions.
- Invalid product references.
- Deleted or deactivated products.
- Exchange-rate changes during checkout.
- Printer disconnection.
- Customer display failure.
- Scanner input errors.
- Browser refresh during payment.

Favor explicit states and safe recovery over silent failures.

---

# PART XVIII — IMPLEMENTATION DOCUMENTATION

## 20. Required Documentation

Create these files in the repository:

### AGENTS.md

Development instructions, architectural invariants, security requirements, coding conventions and quality gates.

### projectguideline.md

Overall project vision, business requirements, architecture, technical stack, application structure and integration constraints.

### features.md

Complete feature catalogue and implementation statuses.

### progress.md

Chronological development progress, completed work, current phase, failed checks and next steps.

### architecture.md

System architecture, data flows, API boundaries, authentication, database transactions, payments and hardware interfaces.

### database-contract.md

Shared Supabase tables, required fields, permissions, migrations, RPC contracts, exchange-rate logic and website dependencies.

### testing.md

Testing strategy, actual test results, limitations and remaining QA activities.

Use explicit statuses such as:

- Not started.
- In progress.
- Implemented.
- Tested.
- Blocked.
- Deferred.

Do not mark features complete merely because a component exists.

---

# PART XIX — DEVELOPMENT ROADMAP

## 21. Implementation Phases

### PHASE 0 — Foundation

- Inspect the new project.
- Configure dependencies.
- Establish folder conventions.
- Create documentation.
- Define the design system.
- Establish security and data-flow rules.
- Document shared Supabase compatibility requirements.

### PHASE 1 — Authentication

- Secure login.
- Staff identity.
- Role-based permissions.
- Protected layouts.
- Session management.

### PHASE 2 — Database Integration

- Supabase connection.
- Product catalogue access.
- Shared schema compatibility.
- Safe RPC interfaces.
- Inventory transactions.
- RLS tests.

### PHASE 3 — Sales Terminal

- Product grid.
- Search and filtering.
- Barcode scanning.
- Shopping cart.
- Cash checkout.
- Server-confirmed sales.
- Receipt generation.

### PHASE 4 — Management

- Dashboard.
- Product editing.
- Product creation.
- Inventory adjustments.
- Staff management.
- Sales history.
- Returns.
- Reports.

### PHASE 5 — Currency and Website Integration

- Central exchange rate.
- KES/USD conversion.
- Website-compatible pricing interface.
- Inventory synchronization.
- Website order notifications.

### PHASE 6 — Hardware

- Customer display.
- Scanner integration.
- Thermal printer formatting.
- Hardware connection management.
- Simulators and hardware tests.

### PHASE 7 — Payments

- M-Pesa configuration.
- Payment attempt persistence.
- STK Push.
- Callback handling.
- Payment verification.
- Transaction reconciliation.

### PHASE 8 — Production Hardening

- Security tests.
- Concurrency tests.
- End-to-end testing.
- Performance checks.
- Responsive testing.
- Build validation.
- Deployment readiness review.

Do not skip critical dependency checks merely to advance through the phases.

---

# PART XX — AUTONOMOUS DEVELOPMENT INSTRUCTIONS

## 22. How You Must Work

You are authorized to proceed with local project development without repeatedly requesting confirmation.

Follow these rules:

1. Read existing project files first.
2. Create a complete implementation plan.
3. Begin implementation in dependency order.
4. Work in manageable, testable increments.
5. Keep the application buildable.
6. Update documentation after meaningful changes.
7. Run relevant tests regularly.
8. Resolve discovered implementation errors.
9. Avoid unrelated modifications.
10. Do not overwrite the old POS.
11. Do not change live production infrastructure without authorization.
12. Clearly document external requirements or blockers.
13. Never invent test results or claim unverified functionality.
14. Continue to the next safe development task when the current one is complete.
15. Use fixtures and disposable infrastructure when external credentials or live services are unavailable.

## 23. Definition of Done

A feature is complete only when:

- Implementation exists.
- Validation is present.
- Authentication and authorization are correct.
- Database operations are safe.
- Error handling is implemented.
- TypeScript passes.
- Lint passes.
- Relevant tests pass.
- Documentation is updated.
- Existing functionality remains intact.

A passing build is not proof that payment, hardware or database integrations operate correctly.

## FINAL DIRECTIVE

Build Pedigree POS 2.0 as a fresh, cleanly architected, online-first retail management system.

The application must be reliable, maintainable, secure, visually polished and compatible with the existing Pedigree Leather e-commerce ecosystem.

Start with the foundation, documentation, database contract and authentication.

Proceed through the development phases systematically.

Preserve the essential business features without carrying forward the old POS application's unsafe offline-first assumptions.

**Begin implementation now.**