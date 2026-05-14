# Sportsmart Sprint Plan

**Last updated:** 2026-05-13
**Sprint length:** 2 weeks (Mon → Fri)
**Team:** solo / 1–2 engineers
**Sprint 1 start:** 2026-05-18
**MVP target (end of Sprint 27):** 2027-05-28 (~12 months)

This document translates [MASTER_PLAN.md](./MASTER_PLAN.md) into a sprint-by-sprint schedule. MASTER_PLAN remains the source of truth for **what and why**; this is the source of truth for **when and in what order**. [STATUS_TRACKER.md](./STATUS_TRACKER.md) records progress per feature.

---

## How to use this document

- **Sprints are projections, not contracts.** Solo velocity is noisy; estimates assume ~1 substantive feature per week of focused work. Re-baseline every 4–6 sprints.
- **Plan files** (per feature) under `docs/plans/phase-N-*/` are the working artifact during a sprint. Update STATUS_TRACKER as items move `planned → in_progress → review → done`.
- **Each sprint has one demo.** The demo answers "what's now possible that wasn't before?" If no answer fits, the sprint scope was too small.
- **Re-read MASTER_PLAN at the start of every phase.** Exit criteria there are non-negotiable; this doc's sprint boundaries are negotiable.

---

## Current state on 2026-05-13 (anchor)

Captured live so future readers know the starting baseline:

- ✅ All 8 frontends + API boot via `pnpm dev` (ports 4000–4007 + API:8000)
- ✅ 24 migrations applied today; DB schema up to date
- ✅ Prisma client regenerated (v6.19.2)
- ⚠️ **15 TS errors** in `apps/api/src/modules/orders/application/services/verification-queue.service.ts` (was "6 outstanding" in MASTER_PLAN; the gap grew). References columns `MasterOrder.verificationScoredAt`, `claimedByAdminId`, `claimExpiresAt` that don't exist in `prisma/schema/orders.prisma`. Likely an in-progress feature where code shipped before schema migration. **This is Sprint 1's first ticket.**
- ⚠️ `apps/api/result.txt` and `prisma/schema/admin.prisma.bak` are committed cruft (delete in Sprint 1 cleanup)
- ⚠️ Frontend `tests/` folders are all empty (CI runs only lint+typecheck+build)
- ⚠️ `infra/{nginx,aws,ci-cd,scripts}/` are `.gitkeep`-only stubs (no production deployment manifests in repo)
- ⚠️ `infra/docker/Dockerfile.api` has a placeholder SHA256 digest (`sha256:000…0`) at line 39 — blocks any prod image build
- ⚠️ `web-affiliate/src/services/admin-franchises.service.ts` is copy-paste residue (wrong-named service in an affiliate portal)
- ⚠️ `web-affiliate` + `web-affiliate-admin` use single-token auth (no refresh) while the other 6 apps use refresh tokens

These don't all belong in Phase 0, but they should be tracked. The plan absorbs them where they fit best.

---

## Cadence and ceremonies (solo-friendly)

Even solo work benefits from sprint structure — it bounds scope and forces honest weekly assessment.

| Ceremony | When | Duration | Purpose |
|---|---|---|---|
| Sprint kickoff | Mon of week 1, ~30 min | Pull next sprint's stories, set DoD, write decision log entry | Commit to what you'll deliver |
| Daily check-in | EOD, ~5 min | Write one paragraph: did / blocked / tomorrow | Forces honest progress signal; reads back well at retro |
| Mid-sprint review | EOD Fri week 1, ~20 min | Are you on track? If 50% behind, descope now, not Fri week 2 | Catch scope slip before it compounds |
| Sprint demo + retro | Fri week 2, ~45 min | Demo the one new capability; write 3-line retro: keep / change / try | Demo discipline forces shippable work |
| Backlog grooming | Fri week 2 after demo, ~30 min | Update STATUS_TRACKER; refine next sprint's plan files | Sprint N+1 has a runnable plan by Friday |

For 1-2 person teams, async standups in a shared doc work better than meetings.

---

## Definition of Ready (before a story enters a sprint)

A story is "ready" when:
1. The plan file under `docs/plans/phase-N-*/` exists and has §13 test plan filled in
2. Acceptance criteria are testable (not "improve X")
3. Edge cases enumerated (per the `_template.md` discipline — §9)
4. Dependencies green (the things this depends on are `done` per STATUS_TRACKER)
5. Estimated in days (rough — half-day, 1-day, 2-day, 3-day, "needs splitting")

## Definition of Done (before a story closes)

1. Tests written and green (unit + at minimum one integration / smoke path)
2. Lint + typecheck pass with **zero new errors**
3. Migrations created via `prisma migrate dev` (no `db push`)
4. ADR written if any non-obvious decision was made
5. STATUS_TRACKER row flipped to `done`
6. Smoke-test suite (Phase 0.4) still green
7. The feature is reachable from the relevant frontend (if frontend work is in scope) or demonstrable via `curl` (if backend-only)

---

## Cross-cutting work in every sprint (no separate stories)

Per MASTER_PLAN §Cross-cutting threads — these get folded into each story, not scheduled separately:

- **Tests** — every story has a test budget; no merge without §13 satisfied
- **Migrations** — Prisma migrate only; commit the generated SQL in the same PR as the code change
- **Docs** — every story ends with a 1-paragraph update to either the feature plan file or the ADR list
- **Smoke tests** — re-run end-of-sprint; regressions block the demo from being called "done"

---

## Roadmap at a glance

| Phase | Sprints | Calendar | MASTER_PLAN exit criteria |
|---:|:---:|---|---|
| **0** — Foundation | 1 | 2026-05-18 → 2026-05-29 | API builds zero TS errors; `pnpm dev` works fresh; smoke suite green |
| **1** — Wire orphan modules | 2–4 | 2026-06-01 → 2026-07-10 | Every module owns ≥1 controller; affiliate flow E2E demo |
| **2** — Customer journey depth | 5–7 | 2026-07-13 → 2026-08-21 | Buyer can register → 2 addrs → 2-seller order → COD/online → track |
| **3** — Marketplace ops backbone | 8–11 | 2026-08-24 → 2026-10-16 | 95% auto-routing; AWBs auto-generated; low-stock alerts live |
| **4** — Money flows | 12–16 | 2026-10-19 → 2026-12-25 | Every money path has dual-entry audit + idempotency + recon ±0 |
| **5** — Discovery & content | 17–19 | 2026-12-28 → 2027-02-05 | Search <300ms p95; banner UI; coupon scheduling |
| **6** — Support & insights | 20–22 | 2027-02-08 → 2027-03-19 | Customer can raise ticket; weekly KPI export in 1 click |
| **7** — Brand & AI | 23–24 | 2027-03-22 → 2027-04-16 | Nova landing + 100 SKUs; AI desc on upload; AI search beats keyword |
| **8** — Mobile & hardening | 25–27 | 2027-04-19 → 2027-05-28 | PWA installable; security checklist passes; load test target hit |

Buffer: each phase has natural slack built into its sprint count. If you finish a phase early, **don't** pull forward — instead pay down tech debt or improve test coverage in that slack week.

---

# Detailed sprint plans

## Phase 0 — Foundation

### Sprint 1 · 2026-05-18 → 2026-05-29 · Phase 0

**Goal:** Make the codebase honest. Zero TS errors, reproducible local dev, smoke suite that catches regressions in every subsequent sprint.

**Stories** (all from MASTER_PLAN Phase 0):

| ID | Title | Plan file | Est | Notes (from live state on 2026-05-13) |
|---|---|---|---:|---|
| **0.1** | Fix TS compile errors | `phase-0-foundation/01-fix-typescript-errors.md` | 2d | **15 errors observed**, not 6. Most cluster in `verification-queue.service.ts` referencing 3 missing columns on `MasterOrder`. Two paths: (a) add columns via migration if the feature is desired, (b) delete dead references. Investigate first. |
| **0.2** | `.env` standardisation across all 9 apps | `phase-0-foundation/02-env-standardisation.md` | 1.5d | Root `.env` says `PORT=3000`, `apps/api/.env` overrides to `PORT=8000`. Pick a convention and document. Diff `.env` vs `.env.example` to find drift. |
| **0.3** | One-command `pnpm dev` from fresh clone | `phase-0-foundation/03-local-dev-bring-up.md` | 1.5d | Mostly works today; the *fresh-clone* path is what to validate. Test on a fresh checkout in `/tmp`. Document required tools (Node 22, pnpm 10, Postgres 16, Redis 7). |
| **0.4** | Smoke test suite | `phase-0-foundation/04-smoke-tests.md` | 3d | Login as each actor type (customer, seller, franchise, affiliate, admin × 2), place 1 online + 1 COD order, verify confirmation email enqueues. Run as `pnpm smoke` against a fresh DB. |
| **0.5** | Structured logger + correlation IDs | `phase-0-foundation/05-logging-baseline.md` | 1d | `core/bootstrap/logging/app-logger.service.ts` already exists. Audit that `X-Request-Id` propagates from API → DB query logs → outbound webhook calls. Add tests. |
| 0.6 | **Cleanup pass** (bonus) | — | 0.5d | Delete `apps/api/result.txt`; delete `apps/api/prisma/schema/admin.prisma.bak`. Verify `.gitignore` covers similar artifacts (`*.bak`, test output dumps). |

**Exit criteria:**
- `pnpm --filter @sportsmart/api typecheck` returns 0 errors
- `pnpm dev` from a fresh clone of main on a new machine starts all 9 services
- `pnpm smoke` runs and passes against a fresh DB
- Every `[HTTP]` log line includes `req=<request-id>`

**Risks:**
- TS-error fix might require a schema migration (column add) — if so, that's the *seed* of a feature, write a Phase 4-level ADR for it
- Smoke tests need test seller/franchise/affiliate accounts — those need to be deterministic (seed them, don't hardcode)

**Demo:** Wipe `~/sportsmart_dev`, clone repo to `/tmp/x`, run `pnpm i && pnpm seed && pnpm dev && pnpm smoke` — all green in under 5 minutes.

---

## Phase 1 — Wire orphan modules

Six features. Each is "wire controllers + small frontend" against existing domain code. Bias toward shipping more per sprint since hard parts are done.

### Sprint 2 · 2026-06-01 → 2026-06-12 · Phase 1 (1/3)

**Goal:** Notifications and Files modules become reachable from the admin UI.

**Stories:**
- **1.1 Notifications controllers** (`phase-1-wire-modules/01-notifications-controllers.md`) — feature plan already drafted; 16 tasks, ≤½ day each. **9 admin endpoints, 2 new Prisma tables (`NotificationTemplate`, `NotificationLog`).**
- **1.2 Files & Document Management** (`phase-1-wire-modules/02-files-controllers.md`) — 30 files, 0 controllers. List/download/admin endpoints. Cloudinary adapter already wired (S3 adapter is `notImplemented()` stub — leave for Phase 8).

**Exit:** Admin can list notification logs, edit a template, re-dispatch a failed notification. Admin can list/preview/delete uploaded files. Both modules have ≥80% test coverage on controllers.

**Risks:** Notifications template renderer (Handlebars) may need security review for XSS — flag for Phase 6 if anything iffy surfaces.

### Sprint 3 · 2026-06-15 → 2026-06-26 · Phase 1 (2/3)

**Goal:** Audit queries surfaceable; COD wired into checkout end-to-end.

**Stories:**
- **1.3 Audit query API** (`phase-1-wire-modules/03-audit-query-api.md`) — 26 files, 0 controllers. Logs are being written but nobody can read them. Build paginated/filtered query endpoint for `audit_logs` and `event_logs`. Permission-gate behind `audit.read`.
- **1.4 COD controllers + checkout integration** (`phase-1-wire-modules/04-cod-controllers.md`) — 18 files, 0 controllers. The `CodRuleEngine` is full-featured; need admin CRUD on rules + customer-facing `/cod/evaluate` endpoint already exists per the deep dive.

**Exit:** Admin can search audit logs by actor, date, action. Customer checkout can request COD eligibility for a pincode and get a deterministic yes/no with reason. COD evaluation logged to `cod_decision_log`.

### Sprint 4 · 2026-06-29 → 2026-07-10 · Phase 1 (3/3)

**Goal:** Affiliate flow demonstrable end-to-end.

**Stories:**
- **1.5 Affiliate Admin controllers** (`phase-1-wire-modules/05-affiliate-admin.md`) — list, approve/reject, suspend, view KYC, commission analytics. Backend exists; presentation layer is `.gitkeep` only.
- **1.6 Affiliate Account backend** (`phase-1-wire-modules/06-affiliate-account.md`) — `web-affiliate` UI exists and currently makes 404 calls. Wire dashboard, KYC submission, coupons, earnings, payouts.
- **Bonus:** Delete/rename `web-affiliate/src/services/admin-franchises.service.ts` (copy-paste residue). Investigate whether `/admin/franchises/{id}/coverage` endpoint is what the affiliate coverage page actually needs.

**Exit (= Phase 1 exit):** Every module owns ≥1 controller. Affiliate signs up → admin approves → affiliate submits KYC → admin approves → affiliate copies referral link → simulated order attributes a commission → affiliate sees PENDING commission in their dashboard. End-to-end demo.

**Phase 1 demo:** The end-to-end affiliate flow above, screen-shared in one session.

---

## Phase 2 — Customer journey depth

5 features, 3-week MASTER_PLAN estimate → 3 sprints solo.

### Sprint 5 · 2026-07-13 → 2026-07-24 · Phase 2 (1/3)

**Goal:** Buyer can manage their profile and wishlist.

**Stories:**
- **2.1 Buyer Account** (`phase-2-customer/01-buyer-account.md`) — profile editing, multi-address book, default-address selector. Frontend pages live at `apps/web-storefront/src/app/account/*` and partially exist.
- **2.2 Wishlist** (`phase-2-customer/02-wishlist.md`) — new Prisma model + customer endpoints + storefront UI (add-from-product-card, dedicated `/account/wishlist` page).

**Exit:** Buyer can edit name/email/phone, add 3 addresses, set default, add/remove wishlist items, move wishlist item to cart.

### Sprint 6 · 2026-07-27 → 2026-08-07 · Phase 2 (2/3)

**Goal:** Cart and checkout feel finished.

**Stories:**
- **2.3 Cart Management depth** (`phase-2-customer/03-cart-depth.md`) — multi-seller cart UX (group by seller), save-for-later, coupon entry hook.
- **2.4 Checkout depth (part 1)** (`phase-2-customer/04-checkout-depth.md`) — address validation (PIN format, name/phone required), delivery estimate per option, payment-method selector polish.

**Exit:** Buyer with 2 sellers' items in cart sees them grouped, can save 1 for later, can apply a coupon with live discount preview before payment. Checkout shows EDD per shipping option.

### Sprint 7 · 2026-08-10 → 2026-08-21 · Phase 2 (3/3)

**Goal:** Order tracking is a real customer experience.

**Stories:**
- **2.4 Checkout depth (part 2)** — retry-on-payment-fail UX. If Razorpay returns FAILED, redirect to a "retry payment" screen, not back to cart. Keep cart intact.
- **2.5 Buyer order tracking page** (`phase-2-customer/05-order-tracking.md`) — rich timeline UI: placed → routed → seller-accepted → packed → shipped → out-for-delivery → delivered. Pulls from `master_orders.order_status` history + `sub_orders.last_tracking_event` (added in 2026-05-12 migration).

**Exit (= Phase 2 exit):** A buyer can register → add 2 addresses → browse → add 3 items from 2 sellers → apply a coupon → pay (online + COD) → receive confirmation → track shipment. Full flow demo.

**Phase 2 demo:** Live customer onboarding from email signup through tracked delivery, screen-shared.

---

## Phase 3 — Marketplace ops backbone

5 features, 4-week MASTER_PLAN estimate → 4 sprints solo. Routing engine + Shiprocket are the two heaviest.

### Sprint 8 · 2026-08-24 → 2026-09-04 · Phase 3 (1/4)

**Goal:** Pincode coverage is editable per seller/franchise; COD eligibility map exposes the rule set.

**Stories:**
- **3.1 Serviceability Management** (`phase-3-ops/01-serviceability.md`) — pincode CSV upload per seller, coverage editor UI, COD-eligible flag per pincode-seller pair.

**Risks:** 165k pincodes already seeded — make sure UX scales (search/filter, not paginate-through-everything).

### Sprint 9 · 2026-09-07 → 2026-09-18 · Phase 3 (2/4)

**Goal:** Routing engine v1 — proximity-only.

**Stories:**
- **3.2 Routing Engine (Part 1)** (`phase-3-ops/02-routing-engine.md`) — proximity-only rule (Haversine distance from customer pincode to seller warehouse pincode). Exception queue for unserviceable allocations.

**Risks:** This is MASTER_PLAN's "most consequential module" — keep v1 strictly proximity. Resist scope creep into SLA/cost weighting (that's Sprint 10).

### Sprint 10 · 2026-09-21 → 2026-10-02 · Phase 3 (3/4)

**Goal:** Routing engine handles real-world edge cases; Shiprocket starts shipping shipments.

**Stories:**
- **3.2 Routing Engine (Part 2)** — SLA-weighted and cost-weighted rules; manual reassign UI for stuck allocations; auto-fallback on seller rejection.
- **3.3 Shipping (Part 1)** (`phase-3-ops/03-shipping-shiprocket.md`) — Shiprocket adapter completion (`shiprocket.adapter.ts` is partially there per the integrations review). AWB generation flow.

### Sprint 11 · 2026-10-05 → 2026-10-16 · Phase 3 (4/4)

**Goal:** Shipping closes the loop; inventory and seller mapping reach production depth.

**Stories:**
- **3.3 Shipping (Part 2)** — tracking webhook ingestion (already partly wired via iThink), NDR handling, label/manifest printing.
- **3.4 Inventory depth** (`phase-3-ops/04-inventory-depth.md`) — low-stock alerts (model exists, alerting cron needed), audit log viewer, transfer-between-locations API.
- **3.5 Seller Product Mapping depth** (`phase-3-ops/05-seller-mapping-depth.md`) — bulk CSV mapping, pricing tiers, approval workflow.

**Exit (= Phase 3 exit):** Routing engine routes 95% of new orders without admin intervention; Shiprocket AWBs auto-generate on seller-accepted sub-orders; low-stock alert fires when seller's mapping drops below threshold; admin can bulk-map 100 SKUs in one upload.

**Phase 3 demo:** Place an order to a remote pincode → routing engine picks closest serviceable seller → AWB auto-generated → tracking event flows in → low-stock alert fires when the SKU dips below 5 units.

---

## Phase 4 — Money flows

5 features, 4-week MASTER_PLAN estimate but **2 NEW modules (Wallet, Dispute)** → 5 sprints solo. **No corners cut here.** This phase touches real money.

### Sprint 12 · 2026-10-19 → 2026-10-30 · Phase 4 (1/5)

**Goal:** Refund lifecycle has a controller surface and audit trail.

**Stories:**
- **4.1 Refund Management** (`phase-4-money/01-refund-management.md`) — full lifecycle (request → approval → method selection → bank reference). Builds on existing `RefundInstruction` + `RefundSaga` (ADR-009).
- ADR-017 finance approval gate is already in code — ensure controller paths route gate decisions through the existing `RefundInstructionService`.

**Risks:** Refund saga compensation deliberately throws "manual review required" rather than auto-debit on wallet rollback (per ADR-009). Ops UI must show these clearly. Add a "stuck refunds" admin page.

### Sprint 13 · 2026-11-02 → 2026-11-13 · Phase 4 (2/5)

**Goal:** Seller/franchise payouts: cycles, schedules, downloadable statements.

**Stories:**
- **4.2 Payout Management** (`phase-4-money/02-payout-management.md`) — payout cycles, schedules, statement PDFs, bank UTR tracking. Builds on existing `Settlement` + `SellerLedgerEntry`.

**Risks:** Silent-money-loss guard from PR 0.3 (per the integrations deep dive) must be tested with synthetic bank-mismatch data before this ships.

### Sprint 14 · 2026-11-16 → 2026-11-27 · Phase 4 (3/5)

**Goal:** Wallet module exists end-to-end.

**Stories:**
- **4.3 Wallet Management (NEW)** (`phase-4-money/03-wallet-management.md`) — **net-new module from scratch.** Prisma models: `Wallet`, `WalletTransaction`. Endpoints: balance, transactions, top-up (Razorpay handoff), verify-topup, refund-to-wallet, expiry job.
- Optimistic-lock the wallet (version column) per the existing `wallet.service.ts` pattern.

**Risks:** Wallet is touched by refunds (Sprint 12), so build with `bypassBlock=true` semantic for refund flows from day 1 to avoid retrofitting.

### Sprint 15 · 2026-11-30 → 2026-12-11 · Phase 4 (4/5)

**Goal:** Disputes are a first-class module.

**Stories:**
- **4.4 Dispute Management (NEW)** (`phase-4-money/04-dispute-management.md`) — **net-new module.** Customer files dispute (wrong/damaged/missing). Evidence upload. Seller response window (48h). Admin decision with `liabilityParty` + `customerRemedy` (per ADR-016). Decision creates `RefundInstruction` via saga.
- FSM: `OPEN → UNDER_REVIEW → AWAITING_INFO → RESOLVED_BUYER/SELLER/SPLIT → CLOSED`

**Risks:** Lots of cross-module wiring (`returns`, `refund-instructions`, `liability-ledger`, `wallet`). Use the dependency-matrix to verify each cross-call is `D` or `E`.

### Sprint 16 · 2026-12-14 → 2026-12-25 · Phase 4 (5/5)

⚠️ **Christmas week** — budget for ~40% capacity in week 2. Pull only what's safe to pause mid-stream.

**Goal:** Reconciliation closes the books.

**Stories:**
- **4.5 Finance & Reconciliation** (`phase-4-money/05-reconciliation.md`) — payment recon (Razorpay statement vs internal records), COD recon, settlement recon, refund recon. Cron jobs that flag discrepancies > ₹1.

**Exit (= Phase 4 exit):** Every money-touching path has dual-entry audit, idempotency keys, and a reconciliation report. Reconciliation matches gateway statements ±0 rupees on a synthetic 100-order test set.

**Phase 4 demo:** Run a synthetic week: place 30 orders, generate 5 returns, 2 disputes, 1 refund-to-wallet, 1 COD bank-mismatch. End-of-week reconciliation report identifies exactly the 1 mismatch.

---

## Phase 5 — Discovery & content

4 features, 3-week MASTER_PLAN → 3 sprints solo.

### Sprint 17 · 2026-12-28 → 2027-01-08 · Phase 5 (1/3)

⚠️ **New Year week 1** — partial capacity.

**Goal:** Search returns real results from OpenSearch, not Prisma full-text.

**Stories:**
- **5.1 Search & Discovery** (`phase-5-discovery/01-search-opensearch.md`) — index `products` to OpenSearch on write (outbox-driven per ADR-008). Query DSL: filters (category, brand, price range), suggestions, basic synonyms.
- Backfill cron to index existing products (one-shot, gated by env flag).

**Risks:** OpenSearch ops overhead — use managed in prod (MASTER_PLAN risk). Local dev: containerized OpenSearch.

### Sprint 18 · 2027-01-11 → 2027-01-22 · Phase 5 (2/3)

**Goal:** Storefront content is editable without deploys.

**Stories:**
- **5.2 Storefront Management** (`phase-5-discovery/02-storefront-cms.md`) — banner editor, home sections, featured products selector, scheduling. Builds on `StorefrontContentBlock` + `StorefrontSlotDefinition` (already in schema per the 2026-05-12 migrations).
- **5.3 Content Management** (`phase-5-discovery/03-content-mgmt.md`) — static pages (policies, FAQ), blog posts (already in schema), SEO blocks.

### Sprint 19 · 2027-01-25 → 2027-02-05 · Phase 5 (3/3)

**Goal:** Coupons get scheduling, BOGO, tiered pricing.

**Stories:**
- **5.4 Promotions & Discounts depth** (`phase-5-discovery/04-promotions-depth.md`) — festival offers, BOGO (buy-N-get-M), tiered (>₹X off, >₹Y%), scheduling, per-user limits. Builds on existing `Discount` + `DiscountReservation` (Phase B work).

**Exit (= Phase 5 exit):** Search returns ranked results <300ms p95. Admin publishes a banner via UI; customer sees it within 60s (i18n cache TTL). Coupon created with start/end + per-user limit; expired coupons return 410 cleanly.

**Phase 5 demo:** Admin schedules a Diwali banner for tomorrow's date + a BOGO coupon. Customer searches "running shoes", sees banner above results, applies coupon at checkout, gets exactly the documented discount.

---

## Phase 6 — Support & insights

4 features, 4-week MASTER_PLAN → 3 sprints solo (one is depth-only on already-shipped audit module).

### Sprint 20 · 2027-02-08 → 2027-02-19 · Phase 6 (1/3)

**Goal:** Customer support ticketing exists.

**Stories:**
- **6.1 Support & Helpdesk (NEW)** (`phase-6-support/01-helpdesk.md`) — **net-new module.** Ticketing (open → in_progress → resolved → closed), FAQ CMS, escalation rules, SLA tracker (uses existing `core/sla`), internal notes (admin-only). Frontend exists in `web-storefront/src/app/help/tickets/*` partially.

### Sprint 21 · 2027-02-22 → 2027-03-05 · Phase 6 (2/3)

**Goal:** Founder-grade reporting.

**Stories:**
- **6.2 Analytics & Reporting** (`phase-6-support/02-analytics-reporting.md`) — dashboards (orders, returns, refunds, seller-mix, franchise-mix) + CSV/PDF export. Frontend `analytics/page.tsx` exists, no backend.

**Risks:** Don't overbuild charts — start with a 6-metric KPI grid + 1 trend line. Iterate later.

### Sprint 22 · 2027-03-08 → 2027-03-19 · Phase 6 (3/3)

**Goal:** Security and audit are operationally usable.

**Stories:**
- **6.3 Security Management** (`phase-6-support/03-security-management.md`) — rate-limit dashboard, session revocation UI (per admin/seller/customer), login-protection rule editor.
- **6.4 Audit & Compliance UI** (`phase-6-support/04-audit-ui.md`) — searchable log viewer (builds on Sprint 3's 1.3 query API), export-on-demand.

**Exit (= Phase 6 exit):** A customer can raise a ticket and get a reply. A founder can pull weekly GMV / return-rate / seller-mix in one click. An admin can revoke a stolen session in <30 seconds.

---

## Phase 7 — Brand & AI

3 features, 3-week MASTER_PLAN → 2 sprints solo. AI demand forecasting is **deferred to v2** (MASTER_PLAN flags as stretch).

### Sprint 23 · 2027-03-22 → 2027-04-02 · Phase 7 (1/2)

**Goal:** Nova SM own-brand has a real catalog and landing page.

**Stories:**
- **7.1 Nova SM Own Brand Management** (`phase-7-brand-ai/01-nova-brand.md`) — own-brand catalog, pricing, margins, merchandising. Builds on existing `Product`/`Brand` with a `is_own_brand` flag + dedicated landing page on storefront.

**Risks:** Don't fork the catalog — Nova is a brand flag, not a separate model. Resist that scope creep.

### Sprint 24 · 2027-04-05 → 2027-04-16 · Phase 7 (2/2)

**Goal:** AI is used meaningfully in two surfaces.

**Stories:**
- **7.2 AI Features** (`phase-7-brand-ai/02-ai-features.md`) — Currently 1 controller (`/ai/generate-product-content`) uses **Google Gemini**, not Anthropic despite `@anthropic-ai/sdk` being installed. Decide: keep Gemini OR switch to Claude. Then add: (a) AI search query understanding (rewrite "blu rning shoo" → "blue running shoes" before OpenSearch), (b) recommendations (collaborative filtering or simple "people also bought").

**Risks:** Rate-limit + cost — track $ spend per endpoint. Cap dev usage with a daily budget.

**Note:** 7.3 AI demand forecasting **deferred to post-MVP**. Marked in `phase-7-brand-ai/03-ai-forecasting.md` but not pulled into any sprint.

**Phase 7 demo:** Customer searches "blu rning shoos" → AI rewrites query → OpenSearch returns blue running shoes. Customer adds one to cart → recommendation strip shows 3 plausible companions. Admin uploads a new Nova product → AI generates description.

---

## Phase 8 — Mobile & hardening

5 features, 3-week MASTER_PLAN → 3 sprints solo. Hybrid API contract (8.2) is forward-looking; bundle with 8.3 security since both touch shared infrastructure.

### Sprint 25 · 2027-04-19 → 2027-04-30 · Phase 8 (1/3)

**Goal:** Customer storefront is mobile-grade.

**Stories:**
- **8.1 Mobile & App Readiness (PWA)** (`phase-8-mobile-hardening/01-pwa.md`) — manifest.json + service worker (offline cart only — not offline browse), home-screen install, mobile-friendly checkout polish, push notification scaffold (just the FCM/APNS plumbing, not yet wired to event bus).

### Sprint 26 · 2027-05-03 → 2027-05-14 · Phase 8 (2/3)

**Goal:** Security and API are launch-ready.

**Stories:**
- **8.2 Hybrid app API contract** (`phase-8-mobile-hardening/02-hybrid-api.md`) — stable versioning policy (`/api/v1`), auth flow that works for native shells (refresh-token TTL, MFA challenge flow), API key model for partner integrations (ADR-015 work already in code).
- **8.3 Security hardening** (`phase-8-mobile-hardening/03-security-hardening.md`) — Helmet headers audit, CSP review, rate-limit policy review (all 5 actor types), secret rotation playbook, replace Dockerfile.api placeholder digest (from anchor section above), httpOnly cookies vs sessionStorage decision for storefront tokens.

### Sprint 27 · 2027-05-17 → 2027-05-28 · Phase 8 (3/3) — **MVP launch sprint**

**Goal:** Production-ready: observable, load-tested, runbook-covered.

**Stories:**
- **8.4 Observability hardening** (`phase-8-mobile-hardening/04-observability-hardening.md`) — SLOs (p95 latency, error rate, recon discrepancies), alert thresholds, error budgets, runbooks for top 10 failure modes. Builds on `core/metrics` + `core/cron-observability`.
- **8.5 Load test + capacity plan** (`phase-8-mobile-hardening/05-load-test.md`) — k6 or Artillery against staging. Target: 100 concurrent buyers + 10 admins, p99 < 1s. Capacity plan: documented thresholds for scaling Postgres, Redis, OpenSearch, API replicas.

**Exit (= Phase 8 exit = MVP exit):**
- PWA installable on Android + iOS Safari
- Security checklist passes (CSP, HSTS, rate limits, secret rotation playbook signed off)
- Load test hits 100 concurrent users without p99 degradation
- Top 10 failure-mode runbooks complete (per existing `docs/runbooks/`)

**MVP launch demo:** Walk the full investor narrative — customer signs up → buys → tracks → returns → refund → wallet credit → support ticket → admin resolves → settlement payouts → seller paid. All on staging, all under SLO.

---

## Risk tracking and adjustment triggers

| Risk | Likelihood | Trigger to act | Adjustment |
|---|:---:|---|---|
| Sprint behind by 50% at mid-sprint review | High | Fri week 1: <50% of stories at "in review" | Descope the lowest-value story to next sprint; do NOT compress the demo |
| Two sprints in a row over-running | High | End of sprint N+1 still missing sprint N goals | Re-baseline: extend phase by 1 sprint; STATUS_TRACKER reflects reality, not aspiration |
| Production incident eats a sprint | Med | Real customer impact for >24h | Pause planned sprint; resume next Monday; document in `docs/runbooks/incident-response.md` |
| Routing engine takes 2x estimate (Phase 3) | Med | Sprint 9 mid-sprint review: rules engine not started | Cut SLA-weighting; ship proximity-only as MVP; SLA in v2 |
| Wallet/Dispute scope creep (Phase 4) | High | Sprint 14 or 15 mid-sprint: schema still being argued | Drop nice-to-haves (per-tx tags, soft-delete); ship minimal but correct |
| OpenSearch ops complexity (Phase 5) | Med | Sprint 17 day 5: indexing pipeline still flaky | Fall back to Prisma full-text for v1; introduce OpenSearch in v2 |
| AI features cost overrun (Phase 7) | Low | Token spend > daily budget cap | Pause AI features; ship Nova-only |
| Pre-launch finding blocks Sprint 27 | Med | Load test or security audit fails | Add 1–2 buffer sprints after 27; **don't** ship a half-baked MVP |

---

## Out of scope for MVP (deferred to v2)

Per MASTER_PLAN §"What's not in this plan" — explicit, intentional cuts:

- Multi-currency / multi-region
- Subscriptions
- B2B / wholesale
- Live chat / video shopping
- Marketplace ads / sponsored listings
- AI demand forecasting (Phase 7.3)
- Native mobile app (Phase 8 ships PWA only; hybrid contract preps for it)

Track v2 candidates in a separate doc (`docs/plans/v2-backlog.md`) when items arise during MVP work.

---

## Open questions to resolve before Sprint 1 starts

1. **Sprint 1's TS-error fix** — are the missing columns (`verificationScoredAt`, `claimedByAdminId`, `claimExpiresAt`) part of a planned feature, or dead references? If planned → write Phase 4-level ADR + add schema migration; if dead → delete code.
2. **AI provider** (Phase 7.2) — keep Gemini or switch to Claude? Decide before Sprint 24.
3. **Port convention** (Sprint 1, story 0.2) — API on 8000 or 3000? Storefront on 4005 stays. Pick one and update all `.env.example` files.
4. **Holiday calendar** — annotate sprints that overlap Diwali (~Nov 2026), Christmas (Sprint 16 already flagged), Holi (~Mar 2027) with reduced-capacity notes.

---

## Maintenance notes for this document

- Re-baseline projected dates after every 4–6 sprints. Solo velocity drifts; honest dates beat aspirational ones.
- When a phase exit criterion changes in MASTER_PLAN, mirror it here in the same edit.
- Sprint summaries (what shipped) belong in STATUS_TRACKER; not here. This doc stays forward-looking.
- If a sprint's scope changes mid-sprint, edit this doc — don't leave the change implicit. The git diff is the audit trail.
