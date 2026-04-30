# Sportsmart Master Plan

**Last updated:** 2026-04-27 (initial draft, post-audit)
**Audit baseline:** 18 modules complete, 18 partial, 8 missing (~62% if partial counts as half).

This document defines **what we build, in what order, and why**. It is the single document an engineer should read on day one to understand where we are and what's next.

The plan is organised in nine **phases**. Phases are sequenced for two reasons:
1. **Dependencies** — a feature in phase N often relies on something delivered in phase N-1.
2. **Risk-cost balance** — early phases pay down technical debt and unlock cheap wins; later phases are higher-cost feature builds.

Phases are executed mostly serially, but features *within* a phase can be parallelised by independent owners.

---

## Phase 0 — Foundation (1 week)

**Goal:** Stop the bleeding. Make the project compile cleanly, run reproducibly, and observable so future phases stand on stable ground.

| # | Feature | Owner | Why now |
|---|---|---|---|
| 0.1 | Fix 6 outstanding TS compile errors (catalog/checkout/returns) | unassigned | API runs but with broken type contract — risks runtime bugs |
| 0.2 | `.env` standardisation across all 7 apps | unassigned | `.env` and `.env.example` drifted; defaults inconsistent |
| 0.3 | Local dev bring-up (one-command `pnpm dev` works for new joiners) | unassigned | Reduces setup time and prevents port-conflict surprises |
| 0.4 | Smoke test suite (login as each actor, place an order) | unassigned | Catches regressions in every later phase |
| 0.5 | Logger / structured logs review (request-id, correlation) | unassigned | Prereq for diagnosing every later phase's bugs |

**Exit criteria:** API builds with zero TS errors. All 7 apps boot via `pnpm dev`. A scripted smoke test passes against a fresh DB.

---

## Phase 1 — Wire orphan modules (2 weeks)

**Goal:** Five modules already have full domain + infrastructure code but **zero controllers**. Wiring them up is high-leverage: the hard part (domain logic) is done.

| # | Feature | Why it's cheap |
|---|---|---|
| 1.1 | Notifications: admin controllers + template management API | 18 files, 0 controllers; event handlers already work |
| 1.2 | Files & Document Management: list/download/admin endpoints | 30 files, 0 controllers; adapters wired to S3/Cloudinary |
| 1.3 | Audit & Compliance: query API for `audit_logs` and `event_logs` | 26 files, 0 controllers; logs are being written, just not queryable |
| 1.4 | COD Management: controller + checkout integration | 18 files, 0 controllers; pincode-based COD rules already modelled |
| 1.5 | Affiliate Admin: controllers (presentation/.gitkeep is empty) | Domain is built; admin can't approve/reject affiliates today |
| 1.6 | Affiliate Account: backend wiring for existing web-affiliate frontend | UI exists, makes 404 calls — embarrassing in demos |

**Exit criteria:** Every module owns ≥1 controller. No module-level orphans. Affiliate end-to-end flow demonstrable.

---

## Phase 2 — Customer journey depth (3 weeks)

**Goal:** Make the buyer flow feel finished. The audit shows cart/checkout exist but are thin; buyer profile UI is missing.

| # | Feature | Note |
|---|---|---|
| 2.1 | Buyer Account: profile editing, multi-address book, default address | UI in `web-storefront/src/app/account/*` |
| 2.2 | Wishlist | Add `wishlists` model + endpoints + storefront UI |
| 2.3 | Cart Management depth: multi-seller carts, save-for-later, coupon hooks | Build on existing thin module |
| 2.4 | Checkout Management depth: address validation, delivery estimate, retry-on-payment-fail UX | Tighten the conversion funnel |
| 2.5 | Buyer-side order tracking page (rich timeline) | Pulls from `OrderRoute`, shipping events |

**Exit criteria:** A buyer can register, add 2 addresses, browse, add 3 items from 2 sellers, apply a coupon, pay (online + COD), receive confirmation, and track shipment.

---

## Phase 3 — Marketplace ops backbone (4 weeks)

**Goal:** The supply side. Routing, serviceability, shipping, and inventory must work for sellers and franchises to fulfill orders reliably.

| # | Feature | Note |
|---|---|---|
| 3.1 | Serviceability Management: pincode upload, coverage editor, COD-eligible map | Per-seller and per-franchise rules |
| 3.2 | Routing Engine: rules (proximity, SLA, cost), exception queue, manual reassign UI | Most consequential module to get right |
| 3.3 | Shipping & Logistics: complete Shiprocket adapter, AWB generation, tracking sync, NDR handling | Shiprocket libs are imported but no integration code found |
| 3.4 | Inventory Management depth: low-stock alerts, audit log viewer, transfer between locations | Build out the audit + alert side |
| 3.5 | Seller Product Mapping: bulk mapping, pricing tiers, approval workflow | Production-readiness improvements |

**Exit criteria:** Routing engine routes 95% of orders without manual intervention; Shiprocket AWBs are auto-generated; sellers see real-time stock and low-stock alerts.

---

## Phase 4 — Money flows (4 weeks)

**Goal:** The places where mistakes cost real money. Refund, payout, wallet, dispute. Cannot be rushed.

| # | Feature | Note |
|---|---|---|
| 4.1 | Refund Management: full lifecycle (request → approval → method → bank ref) | Today: `RefundTransaction` model exists, no controller |
| 4.2 | Payout Management: cycles, schedules, statements, downloadable PDFs, bank-ref tracking | Settlements model exists, payout layer thin |
| 4.3 | Wallet Management (NEW): `Wallet`, `WalletTransaction`, expiry, top-up, refund-to-wallet | Currently only an enum — model from scratch |
| 4.4 | Dispute Management (NEW): wrong/damaged/missing item disputes, evidence upload, resolution workflow | Net-new module |
| 4.5 | Finance & Reconciliation: payment recon, COD recon, settlement recon, refund recon | Builds on 4.1–4.3 |

**Exit criteria:** Every money-touching path has dual-entry audit, idempotency keys, and a reconciliation report. Reconciliation matches gateway statements ±0 rupees.

---

## Phase 5 — Discovery & content (3 weeks)

**Goal:** Surface the catalog. Today the storefront has no real search, no banner CMS, no content layer.

| # | Feature | Note |
|---|---|---|
| 5.1 | Search & Discovery: OpenSearch index, filters, suggestions, synonyms, typo tolerance | OpenSearch container is configured, indexing is not |
| 5.2 | Storefront Management: home sections, featured products, banner editor, scheduling | Beyond the basic `StorefrontFilter` |
| 5.3 | Content Management: static pages (policies, FAQ), blog, SEO blocks | Net-new module |
| 5.4 | Promotions & Discounts depth: festival offers, BOGO, tiered, scheduling | Builds on existing `Discount` model |

**Exit criteria:** Storefront search returns ranked results in <300ms p95; admins can publish a banner and a blog post via UI; a coupon can be created with start/end dates and per-user limits.

---

## Phase 6 — Support & insights (4 weeks)

**Goal:** Run the business. Today there's no helpdesk and limited reporting.

| # | Feature | Note |
|---|---|---|
| 6.1 | Support & Helpdesk (NEW): ticketing, FAQ CMS, escalations, SLA tracker, internal notes | Net-new module |
| 6.2 | Analytics & Reporting: order/return/refund/seller/franchise dashboards + exports | Frontend page exists, no backend |
| 6.3 | Security Management: rate limit dashboard, session revocation UI, login-protection rules | Existing brute-force guard is the only piece |
| 6.4 | Audit & Compliance UI: searchable log viewer, export-on-demand | Phase 1 wired the API; this builds the UI |

**Exit criteria:** A customer can raise a ticket; admins can search/respond. A founder can pull weekly GMV/return-rate/seller-mix in one click.

---

## Phase 7 — Brand & AI (3 weeks)

**Goal:** Differentiation. Sportsmart's own brand line and AI-powered features.

| # | Feature | Note |
|---|---|---|
| 7.1 | Nova SM Own Brand Management: own-brand catalog, pricing, margins, merchandising | Net-new — separate flag on existing `Product`/`Brand` models |
| 7.2 | AI Features: product description generation, search query understanding, recommendations | SDKs imported (Anthropic + Gemini), only 1 controller today |
| 7.3 | AI demand forecasting (initial version) | Stretch goal |

**Exit criteria:** Nova brand has a dedicated landing page and 100+ catalog SKUs. AI generates product descriptions for new uploads. AI search improves CTR vs keyword baseline.

---

## Phase 8 — Mobile & hardening (3 weeks)

**Goal:** Ship on more surfaces and lock down the platform.

| # | Feature | Note |
|---|---|---|
| 8.1 | Mobile & App Readiness: PWA manifest, offline cart, mobile-friendly checkout, push notifications scaffold | Customer storefront first |
| 8.2 | Hybrid app API contract: stable versioning + auth flow for a future React Native shell | Forward-looking |
| 8.3 | Security hardening: helmet headers audit, CSP, rate limit policy review, secret rotation playbook | Pre-launch hygiene |
| 8.4 | Observability hardening: SLOs, alert thresholds, error budgets, runbooks | Pre-launch hygiene |
| 8.5 | Load test + capacity plan | Sets baseline before public launch |

**Exit criteria:** PWA installable; security checklist passes; load test hits target RPS without p99 degradation; runbooks cover top 10 failure modes.

---

## Cross-cutting threads

These run through every phase, not as discrete features:

- **Tests** — every plan has a §13 test plan; no merge without.
- **Migrations** — all DB changes go through Prisma migrations; no `db push` on dev DB.
- **Docs** — every phase ends with a doc-update task; ADRs for non-obvious decisions.
- **Smoke tests** — re-run the Phase 0 smoke suite at the end of each phase. Regressions block.

---

## Risks & contingencies

| Risk | Likelihood | Mitigation |
|---|---|---|
| Routing engine over-engineered | Med | Start with proximity-only allocation; add SLA/cost rules iteratively |
| Shiprocket integration fragile in production | Med | Anti-corruption layer + circuit breaker + manual fallback queue |
| Money-flow bugs cause real loss | Low-but-severe | Phase 4 must include reconciliation tests with synthetic gateway data |
| Search/OpenSearch ops overhead | Med | Use managed OpenSearch in prod; index-on-write with backfill job |
| Affiliate / dispute / wallet scope creep | Med | Cut scope at MVP first pass; hold "v2" features for after Phase 8 |

---

## Sequencing dependency graph (informal)

```
Phase 0 ─→ Phase 1 ─→ Phase 2 ──┐
                  └→ Phase 3 ──┴→ Phase 4 ──┐
                                            ├→ Phase 6 ──→ Phase 8
                  └→ Phase 5 ───────────────┘
                                Phase 7 (parallel from Phase 4)
```

Phase 5 (discovery) and Phase 7 (brand/AI) can start in parallel with Phase 4 if owners are available.

---

## What's *not* in this plan (yet)

Deliberately deferred until after Phase 8:
- Multi-currency / multi-region
- Subscriptions
- B2B / wholesale
- Live chat / video shopping
- Marketplace ads / sponsored listings

These are real features but out of scope for v1 ship.
