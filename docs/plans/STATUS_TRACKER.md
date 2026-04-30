# Feature Status Tracker

**Source of truth for feature completion.** Update the row when a feature changes state. Match the audit baseline below to verify nothing is misclassified.

**Status legend:** `planned` · `in_progress` · `review` · `done` · `blocked`

**Audit baseline (2026-04-27):** 18 ✅ complete · 18 🟡 partial · 8 ❌ missing.

---

## Phase 0 — Foundation

| # | Feature | Plan file | Status | Owner | Notes |
|---|---|---|---|---|---|
| 0.1 | Fix 6 TS compile errors | `phase-0-foundation/01-fix-typescript-errors.md` | planned | — | catalog/checkout/returns |
| 0.2 | `.env` standardisation | `phase-0-foundation/02-env-standardisation.md` | planned | — | drift between `.env` and `.env.example` |
| 0.3 | One-command local bring-up | `phase-0-foundation/03-local-dev-bring-up.md` | planned | — | |
| 0.4 | Smoke test suite | `phase-0-foundation/04-smoke-tests.md` | planned | — | |
| 0.5 | Structured logger / correlation IDs | `phase-0-foundation/05-logging-baseline.md` | planned | — | |

## Phase 1 — Wire orphan modules

| # | Feature | Plan file | Status | Owner | Notes |
|---|---|---|---|---|---|
| 1.1 | Notifications controllers | `phase-1-wire-modules/01-notifications-controllers.md` | planned | — | 18 files, 0 controllers |
| 1.2 | Files & Document Mgmt controllers | `phase-1-wire-modules/02-files-controllers.md` | planned | — | 30 files, 0 controllers |
| 1.3 | Audit query API | `phase-1-wire-modules/03-audit-query-api.md` | planned | — | 26 files, 0 controllers |
| 1.4 | COD controllers + checkout integration | `phase-1-wire-modules/04-cod-controllers.md` | planned | — | 18 files, 0 controllers |
| 1.5 | Affiliate Admin controllers | `phase-1-wire-modules/05-affiliate-admin.md` | planned | — | empty `.gitkeep` in presentation |
| 1.6 | Affiliate Account backend | `phase-1-wire-modules/06-affiliate-account.md` | planned | — | UI exists, calls 404 |

## Phase 2 — Customer journey depth

| # | Feature | Plan file | Status | Owner | Notes |
|---|---|---|---|---|---|
| 2.1 | Buyer Account UI | `phase-2-customer/01-buyer-account.md` | planned | — | profile, addresses |
| 2.2 | Wishlist | `phase-2-customer/02-wishlist.md` | planned | — | new model |
| 2.3 | Cart depth | `phase-2-customer/03-cart-depth.md` | planned | — | multi-seller, save-for-later |
| 2.4 | Checkout depth | `phase-2-customer/04-checkout-depth.md` | planned | — | retry, validation |
| 2.5 | Buyer order tracking page | `phase-2-customer/05-order-tracking.md` | planned | — | timeline UI |

## Phase 3 — Marketplace ops backbone

| # | Feature | Plan file | Status | Owner | Notes |
|---|---|---|---|---|---|
| 3.1 | Serviceability Management | `phase-3-ops/01-serviceability.md` | planned | — | pincode upload, COD eligibility |
| 3.2 | Routing Engine | `phase-3-ops/02-routing-engine.md` | planned | — | rules, exception queue |
| 3.3 | Shipping & Logistics (Shiprocket) | `phase-3-ops/03-shipping-shiprocket.md` | planned | — | adapter, AWB, NDR |
| 3.4 | Inventory depth | `phase-3-ops/04-inventory-depth.md` | planned | — | low-stock, audit, transfer |
| 3.5 | Seller Product Mapping depth | `phase-3-ops/05-seller-mapping-depth.md` | planned | — | bulk, pricing tiers |

## Phase 4 — Money flows

| # | Feature | Plan file | Status | Owner | Notes |
|---|---|---|---|---|---|
| 4.1 | Refund Management | `phase-4-money/01-refund-management.md` | planned | — | full lifecycle |
| 4.2 | Payout Management | `phase-4-money/02-payout-management.md` | planned | — | cycles, statements |
| 4.3 | Wallet Management | `phase-4-money/03-wallet-management.md` | planned | — | NEW module |
| 4.4 | Dispute Management | `phase-4-money/04-dispute-management.md` | planned | — | NEW module |
| 4.5 | Finance & Reconciliation | `phase-4-money/05-reconciliation.md` | planned | — | recon reports |

## Phase 5 — Discovery & content

| # | Feature | Plan file | Status | Owner | Notes |
|---|---|---|---|---|---|
| 5.1 | Search & Discovery (OpenSearch) | `phase-5-discovery/01-search-opensearch.md` | planned | — | indexing + queries |
| 5.2 | Storefront Management | `phase-5-discovery/02-storefront-cms.md` | planned | — | banners, sections |
| 5.3 | Content Management | `phase-5-discovery/03-content-mgmt.md` | planned | — | NEW module |
| 5.4 | Promotions & Discounts depth | `phase-5-discovery/04-promotions-depth.md` | planned | — | scheduling, BOGO, tiered |

## Phase 6 — Support & insights

| # | Feature | Plan file | Status | Owner | Notes |
|---|---|---|---|---|---|
| 6.1 | Support & Helpdesk | `phase-6-support/01-helpdesk.md` | planned | — | NEW module |
| 6.2 | Analytics & Reporting | `phase-6-support/02-analytics-reporting.md` | planned | — | dashboards, exports |
| 6.3 | Security Management | `phase-6-support/03-security-management.md` | planned | — | rate limits, sessions UI |
| 6.4 | Audit & Compliance UI | `phase-6-support/04-audit-ui.md` | planned | — | depends on 1.3 |

## Phase 7 — Brand & AI

| # | Feature | Plan file | Status | Owner | Notes |
|---|---|---|---|---|---|
| 7.1 | Nova SM Own Brand Management | `phase-7-brand-ai/01-nova-brand.md` | planned | — | NEW |
| 7.2 | AI Features depth | `phase-7-brand-ai/02-ai-features.md` | planned | — | content, recommendations, search |
| 7.3 | AI demand forecasting | `phase-7-brand-ai/03-ai-forecasting.md` | planned | — | stretch |

## Phase 8 — Mobile & hardening

| # | Feature | Plan file | Status | Owner | Notes |
|---|---|---|---|---|---|
| 8.1 | Mobile & App Readiness (PWA) | `phase-8-mobile-hardening/01-pwa.md` | planned | — | manifest, push, offline |
| 8.2 | Hybrid app API contract | `phase-8-mobile-hardening/02-hybrid-api.md` | planned | — | versioning |
| 8.3 | Security hardening | `phase-8-mobile-hardening/03-security-hardening.md` | planned | — | helmet, CSP |
| 8.4 | Observability hardening | `phase-8-mobile-hardening/04-observability-hardening.md` | planned | — | SLOs, runbooks |
| 8.5 | Load test + capacity plan | `phase-8-mobile-hardening/05-load-test.md` | planned | — | pre-launch |

---

## Cross-reference: audit categories vs phase

| Audit module | Status (audit) | Phase | Plan file |
|---|---|---|---|
| Super Admin Management | ✅ Complete | — | (no work) |
| Role Management | ✅ Complete | — | (no work) |
| Buyer Account | 🟡 Partial | 2 | 01-buyer-account.md |
| Seller Admin | ✅ Complete | — | (no work) |
| Seller Account | ✅ Complete | — | (no work) |
| Franchise Admin | ✅ Complete | — | (no work) |
| Franchise Account | ✅ Complete | — | (no work) |
| Affiliate Admin | 🟡 Partial | 1 | 05-affiliate-admin.md |
| Affiliate Account | 🟡 Partial | 1 | 06-affiliate-account.md |
| Category Management | ✅ Complete | — | (no work) |
| Brand Management | ✅ Complete | — | (no work) |
| Product Management | ✅ Complete | — | (no work) |
| Product Variant Management | ✅ Complete | — | (no work) |
| Seller Product Mapping | ✅ Complete | 3 | 05-seller-mapping-depth.md (depth only) |
| Inventory Management | 🟡 Partial | 3 | 04-inventory-depth.md |
| Search & Discovery | 🟡 Partial | 5 | 01-search-opensearch.md |
| Storefront Management | 🟡 Partial | 5 | 02-storefront-cms.md |
| Cart Management | 🟡 Partial | 2 | 03-cart-depth.md |
| Checkout Management | 🟡 Partial | 2 | 04-checkout-depth.md |
| Serviceability Management | 🟡 Partial | 3 | 01-serviceability.md |
| Routing Engine | 🟡 Partial | 3 | 02-routing-engine.md |
| Order Management | ✅ Complete | — | (no work) |
| Shipping & Logistics | 🟡 Partial | 3 | 03-shipping-shiprocket.md |
| Payment Management | ✅ Complete | — | (no work) |
| COD Management | 🟡 Partial | 1 | 04-cod-controllers.md |
| Returns Management | ✅ Complete | — | (no work) |
| Refund Management | 🟡 Partial | 4 | 01-refund-management.md |
| Dispute Management | ❌ Missing | 4 | 04-dispute-management.md |
| Wallet Management | ❌ Missing | 4 | 03-wallet-management.md |
| Commission Management | ✅ Complete | — | (no work) |
| Settlement Management | ✅ Complete | — | (no work) |
| Payout Management | 🟡 Partial | 4 | 02-payout-management.md |
| Notifications Management | 🟡 Partial | 1 | 01-notifications-controllers.md |
| Support & Helpdesk | ❌ Missing | 6 | 01-helpdesk.md |
| Analytics & Reporting | 🟡 Partial | 6 | 02-analytics-reporting.md |
| Finance & Reconciliation | 🟡 Partial | 4 | 05-reconciliation.md |
| Content Management | ❌ Missing | 5 | 03-content-mgmt.md |
| Promotions & Discounts | ✅ Complete | 5 | 04-promotions-depth.md (depth only) |
| File & Document Management | 🟡 Partial | 1 | 02-files-controllers.md |
| Audit & Compliance | 🟡 Partial | 1+6 | 03-audit-query-api.md / 04-audit-ui.md |
| Security Management | 🟡 Partial | 6+8 | 03-security-management.md / 03-security-hardening.md |
| Nova SM Own Brand Management | ❌ Missing | 7 | 01-nova-brand.md |
| AI Features | 🟡 Partial | 7 | 02-ai-features.md |
| Mobile & App Readiness | ❌ Missing | 8 | 01-pwa.md |

Total individual plan files: **34** (some audit modules merge into shared plans, e.g. promotions and seller-product-mapping are depth-only).
