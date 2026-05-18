# End-to-end test harness — design + runbook

**Audience:** platform engineer designing the order-to-refund happy-path
suite.

**Last updated:** 2026-05-16 (Phase 15). Owners: platform team.

## Why this doc exists

The §15 audit flagged "No E2E for order → payment → fulfillment →
return → refund" as a HIGH gap. The 252 unit + integration specs in
the repo verify individual modules in isolation; what they don't
prove is that the modules **compose** correctly across a real end-
to-end purchase. That gap was carried in the audit, and the
remediation needed more than a single test file — it needed a
harness decision the team hadn't yet made.

This doc captures the decision context so the next PR can land the
harness without re-litigating it.

## The flow we want to cover

```
   POST /storefront/cart/items        ← add items
        │
        ▼
   POST /storefront/checkout/place   ← place order (creates MasterOrder + SubOrders)
        │
        ▼
   POST /storefront/payments/...     ← Razorpay capture (use the test gateway)
        │
        ▼
   PATCH /seller/orders/:id/accept   ← seller accepts
        │
        ▼
   PATCH /seller/orders/:id/ship     ← seller ships
        │
        ▼
   POST /shipping/webhooks/...       ← carrier delivers (webhook with delivery status)
        │
        ▼
   POST /customer/returns            ← customer requests return
        │
        ▼
   PATCH /admin/returns/:id/qc       ← admin completes QC
        │
        ▼
   POST /admin/returns/:id/refund    ← admin issues refund
        │
        ▼
   GET /customer/orders/:id          ← assert refund visible + status correct
```

A pass through every step proves the basic happy-path composition.
Each step is its own unit-tested service; the value of the E2E is
catching wiring bugs that no per-module spec ever sees.

## Harness decision

Two viable approaches:

**Option A — In-process Nest TestingModule with a real Postgres + Redis**

Nest's `Test.createTestingModule({ imports: [AppModule] })` spins up
the full DI tree against a real DB/Redis (provided via testcontainers
or compose). HTTP layer goes through `supertest(app.getHttpServer())`.

Pros:
- Single process; deterministic; debuggable in VSCode.
- No external dependencies in CI beyond Docker.
- Spec lives in `test/e2e/order-flow.e2e-spec.ts` next to existing
  `health.e2e-spec.ts`.

Cons:
- Carrier webhook step needs the spec to post against the running
  process (which works in-process via supertest).
- Razorpay test gateway requires network access from CI — gate behind
  a `RAZORPAY_E2E_KEY` secret that's set in the actions/secrets store.

**Option B — Out-of-process against a running staging API**

The existing `test/integration/return-qc-flow.integration-spec.ts`
follows this pattern: fetch against `API_TEST_BASE_URL`, skip when
unreachable. Specs hit a separately-managed Prisma client for
seeding.

Pros:
- Cheap to add — no new harness code.
- Already proven for return/QC flows.

Cons:
- Manual setup ("run pnpm dev in a separate terminal") doesn't play
  with CI.
- Cleanup is fragile (afterEach trying to undo data the prior step
  inserted).
- Slower to debug (no in-process breakpoint).

## Recommendation

**Option A.** The order flow is too multi-step to drive cleanly through
the integration-spec pattern, and the in-process harness gives us
deterministic tear-down via Prisma's transactional rollback (the
spec wraps the whole flow in a Prisma transaction that rolls back
after the assertions complete).

## Pre-conditions before this lands

* [ ] Add `testcontainers` (or docker-compose helper) to the dev
      dependencies so CI can spin up Postgres+Redis on demand.
* [ ] Seed fixture: one Seller (ACTIVE, KYC complete), one Product
      with a ProductVariant, one Customer with a verified email, one
      shipping address. Pre-seeded by `prisma/seed/seed-e2e-fixtures.ts`.
* [ ] Mock the Razorpay client at the integration boundary (`RazorpayClient`)
      with a deterministic capture path — real network would make the
      spec flaky on CI rate limits.
* [ ] Mock iThink + WhatsApp similarly. Mocks live in `test/e2e/mocks/`.

## What this PR delivers

This PR (§15 closure) ships the **module-level smoke specs** that
were the most-cited gap in the audit:

* `sellerRejectOrder` — 12 tests covering the 5-phase flow.
* `NotificationGateService.check` — 8 tests covering suppression /
  opt-out / preference branches.
* `LowStockAlertService.sweep` — 7 tests covering the four
  state transitions.
* `computeSlaTarget` — 8 tests covering wall-clock + business-hour
  modes.
* `normalizeOrderRef / normalizeReturnRef` — 9 tests covering the
  resolver behaviour.
* `PaymentOpsService.transitionAlert` — 5 tests covering the
  RESOLVED / IGNORED / re-open branches.
* `SettlementService.approveCycle + markSettlementPaid` — 9 tests
  covering the happy path + the negative branches.

The E2E suite is deferred to its own PR per the harness decision
above. Tracking ticket: PLATFORM-E2E-001.
