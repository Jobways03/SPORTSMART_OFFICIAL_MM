# ADR 018 — Returns industry-grade lifecycle (Phase 13)

**Status:** Accepted (2026-05-07)
**Phase:** 13 (post-Phase-12)
**Extends:** ADR-016 (dispute liability ledger), ADR-017 (refund finance approval gate)

## Context

Phase 12 (ADR-016 + ADR-017) brought the *dispute*-side money flow to
industry standard: every dispute decision routes through
`RefundInstruction` → saga → wallet, with a finance approval gate
above a configurable threshold and a liability ledger
(`SellerDebit` / `LogisticsClaim` / `PlatformExpense`) recording
who pays.

Returns were left on the legacy path. They worked, but they were
missing the parity ADR-016 brought to disputes:

- No `liabilityParty` / `customerRemedy` columns on `Return`
- QC submission directly credited the wallet via
  `RefundGatewayService.processRefund` (no `RefundInstruction`,
  no idempotency surface beyond `WalletTransaction`'s UNIQUE).
- No fairness gate giving the seller a chance to contest
  before the platform debits their settlement.
- No risk model — `CustomerAbuseCounter` hit a binary
  "manual review" flag, but couldn't differentiate a
  ₹500 changed-mind return from a ₹15,000 chargeback-history
  WRONG_ITEM claim with no photo.
- Reason-based evidence requirement was uniform — every return
  needed ≥1 photo, including CHANGED_MIND where there's nothing
  visually to prove.
- No replacement / exchange flow at all.

The Sportsmart business explicitly wants to ship at industry-grade
standards from day one rather than backfill after launch incidents.

## Decision

Phase 13 brings the return-side surface to parity with disputes,
plus three return-specific features that disputes don't have:
seller-response lifecycle, replacement / exchange flow, and a
rule-based intake risk model. Disputes are explicitly out-of-scope
in this phase.

### Schema (5 migrations)

| Migration | Adds |
|---|---|
| `20260507200000_return_liability_attribution` | `liability_party`, `customer_remedy`, `qc_rationale`, `qc_internal_notes`, `qc_courier_name`, `qc_awb_number` columns + indexes on the first two |
| `20260507300000_return_seller_response_lifecycle` | `SellerResponseStatus` enum (`NOT_REQUIRED` / `PENDING` / `ACCEPTED` / `CONTESTED` / `EXPIRED`) + 5 columns + composite index for the cron sweep |
| `20260507400000_return_risk_scoring` | `risk_score` (Int), `risk_flags` (Jsonb), `risk_scored_at` columns |
| `20260507500000_return_replacement_exchange` | `ReplacementRequestStatus` enum + 5 columns + extends `CustomerRemedy` with `REPLACEMENT` / `EXCHANGE` (additive — disputes never write them) |
| `20260507600000_admin_task_return_kinds` | Two new `AdminTaskKind` values: `RETURN_REFUND_FAILED`, `RETURN_LIABILITY_LEDGER_BACKFILL` |
| `20260507700000_return_exchange_razorpay` | `exchange_razorpay_order_id`, `exchange_payment_completed_at` columns + partial index |
| `20260507800000_phase13_completion` | Extends `LiabilityParty` enum with `FRANCHISE`, `BRAND`, `INCONCLUSIVE` |

### Decision matrix (mirrors ADR-016 dispute matrix)

Return QC submission requires `liabilityParty` × `customerRemedy`
when any item is approved. Allowed combinations:

| `newStatus` | `customerRemedy` | Allowed `liabilityParty` |
|---|---|---|
| `QC_APPROVED` | `FULL_REFUND` | `SELLER` / `LOGISTICS` / `PLATFORM` / `FRANCHISE` / `BRAND` / `INCONCLUSIVE` / `NONE` |
| `QC_APPROVED` | `GOODWILL_CREDIT` | `PLATFORM` only (goodwill is non-recoverable by definition) |
| `QC_APPROVED` | `REPLACEMENT` / `EXCHANGE` | any |
| `PARTIALLY_APPROVED` | `PARTIAL_REFUND` | any non-CUSTOMER |
| `QC_REJECTED` | (skipped — customer fault) | (no remedy needed) |

Forbidden combos throw `BadRequestAppException` with a clear admin-
facing message and the return state is not modified.

### Money-flow contract

QC approval triggers exactly one of these paths, **never a direct
wallet credit from `ReturnService`**:

1. **Cash refund (FULL / PARTIAL / GOODWILL)** —
   `RefundInstructionService.createForReturn` mints an instruction
   keyed `return:<id>`. Below the auto-approve threshold (env
   `REFUND_AUTO_APPROVE_THRESHOLD_PAISE`, default ₹10,000, with
   per-method overrides) the saga runs inline and credits the
   wallet via `WalletPublicFacade.creditFromRefund` (UNIQUE on
   `referenceType`+`referenceId`+`type` prevents double-credit).
   Above the threshold the row enters `PENDING_APPROVAL` and a
   finance reviewer with `refunds.approve` resolves it via
   the `/admin/refund-instructions/:id/approve` endpoint.

2. **Replacement (same SKU)** — `ReplacementOrderService` creates
   a real `MasterOrder` + `SubOrder` + `OrderItem` at ₹0,
   decrements `ProductVariant.stock` atomically inside the same
   transaction, stamps `replacementOrderId` on the return, flips
   `replacementStatus → AWAITING_FULFILMENT`. Order number gets
   `-R` suffix so ops can spot it. No money flow.

3. **Exchange — same price** — same as REPLACEMENT but with the
   target variant.

4. **Exchange — replacement cheaper** — replacement order at ₹0
   plus a partial `RefundInstruction` for the diff (idempotency
   key `return:<id>:exchange-diff` so it doesn't collide with
   the main flow).

5. **Exchange — replacement pricier** — `replacementStatus →
   AWAITING_PAYMENT`, `exchangePriceDiffPaise` stamped, no order
   yet. Customer's storefront shows a "Pay ₹X" CTA that mints a
   Razorpay order via `/customer/returns/:id/exchange-payment-init`,
   completes via `/exchange-payment-verify` (HMAC-verified,
   constant-time-compared, fail-closed on blank key). On verify
   success the replacement-order pipeline takes over and ships
   the new SKU.

6. **Out of stock** (any of 2–5) — `replacementStatus →
   FALLBACK_TO_REFUND`, AdminTask enqueued for finance to
   convert to a normal cash refund.

### Liability ledger writes

| `liabilityParty` × `customerRemedy` | Ledger row |
|---|---|
| any × `GOODWILL_CREDIT` | `PlatformExpense` (`expenseType=GOODWILL`) |
| `SELLER` × cash refund | `SellerDebit` (recovered from next settlement) |
| `LOGISTICS` × cash refund | `LogisticsClaim` (filed against courier) |
| `PLATFORM` / `FRANCHISE` / `BRAND` / `INCONCLUSIVE` × cash refund | `PlatformExpense` (`expenseType=PLATFORM_FAULT`; `reason` text records the actual party so finance can reconcile against franchise/brand statements) |
| `CUSTOMER` / `NONE` | (no ledger row — refund either rejected or absorbed by default platform path) |
| any × `REPLACEMENT` / `EXCHANGE` | (no ledger row at QC time — money flow is the price-diff Razorpay payment, not a wallet credit) |

All ledger writes are idempotent on `(sourceType=RETURN, sourceId)`.

### Safety gates (server-side, audit-logged)

1. **Decision matrix** — invalid `liabilityParty × customerRemedy`
   combinations throw before any DB write.
2. **Seller-response window** — when `liabilityParty=SELLER` and
   `sellerResponseStatus=PENDING`, QC throws unless admin sets
   `overrideSellerResponseWindow=true`. The override is captured
   in the audit log entry.
3. **High-risk acknowledgement** — when `riskScore ≥ 60` and a
   cash refund is being issued, QC throws unless admin sets
   `acknowledgeHighRisk=true`. The ack + the score at decision
   time are stamped on the audit row.

### Risk model (P1.11)

Rule-based 5-dimension scorer running at intake (best-effort,
never blocks return creation). Each dimension is a pure function
from a `RiskSnapshot` to `{ score, flag? }`; the aggregator sums
and clamps to 0-100.

| Dimension | Trigger | Score |
|---|---|---|
| `CUSTOMER_ABUSE` | `CustomerAbuseCounter.requiresManualApproval` | 40 |
| `HIGH_RECENT_RETURN_COUNT` | ≥3 returns in 30 days | 15–30 (linear) |
| `HIGH_VALUE_WEAK_EVIDENCE` | ≥₹5k + 0 photos | 25 |
| `HIGH_VALUE` (alone) | ≥₹10k with photos | 10 |
| `MISSING_ITEM_CLAIM` | `WRONG_ITEM` + 0 photos | 15 |
| `CHARGEBACK_HISTORY` | any lifetime chargeback | 25 |

Routing:
- 0–29 LOW → auto-approval rules apply as before
- 30–59 MEDIUM → auto-approval requires trusted reasons (existing logic)
- 60–100 HIGH → blocks auto-approval; admin must explicitly ack at QC

Per spec: risk score never causes auto-rejection. Worst case is
manual review.

### Seller-response lifecycle (P1.8)

Returns alleging seller fault (DEFECTIVE / WRONG_ITEM /
NOT_AS_DESCRIBED / QUALITY_ISSUE / OTHER) auto-open a 48h
response window at creation. Reasons routing through different
liability paths (CHANGED_MIND, SIZE_FIT_ISSUE, DAMAGED_IN_TRANSIT)
skip with `NOT_REQUIRED`.

Seller actions via `PATCH /seller/returns/:id/respond`:
- `ACCEPTED` — seller agrees with claim, refund proceeds normally
- `CONTESTED` — seller disagrees; notes required, evidence URLs
  optional. Admin can still override at QC.

A 5-min cron (`SellerResponseSweeperCron`, instrumented via
`CronInstrumentationService`) flips `PENDING → EXPIRED` past due
date so QC defaults to seller fault if no response. Audit log
records the transition.

### Audit log surface

Phase 13 writes 16 distinct `action` values. Aggregated in the
unified `audit_logs` table for compliance search:

```
return.created
return.approved
return.rejected
return.cancelled
return.pickup_scheduled
return.in_transit
return.received
return.qc_decided
return.refund_initiated
return.refund_completed
return.refund_failed
return.closed
return.seller_responded
return.exchange_payment_completed
commission.frozen
commission.reversed
wallet.refund_credit_created
authz.evaluate (DENY only — ALLOW lives in dedicated authorization_audits)
```

### Test coverage

| Layer | Suites | Tests |
|---|---|---|
| Unit (pure-function helpers) | 9 | 127 — matrix, seller-response classifier, risk scorer, replacement/exchange classifier, Razorpay HMAC verifier, wallet idempotency, admin permissions config |
| Integration (real API + dev DB) | 4 | 56 — full QC flow Cases 1-6, EXCHANGE EXACT_MATCH / REFUND_TO_CUSTOMER / COLLECT_FROM_CUSTOMER / out-of-stock, REPLACEMENT in-stock / out-of-stock, fairness gates, seller respond, evidence reason-based, wallet+ledger idempotency, migration shape |

Integration suite uses `maxWorkers: 1` to serialize against the
shared dev DB. Per-test schema isolation is the right long-term
fix; serialization is acceptable while the suite is small.

## Consequences

**Pros:**
- Returns now match the dispute money-flow story — single audit
  trail, single idempotency surface, single recovery path per
  liability party.
- Finance gets a queryable ledger from day one instead of
  backfilling after the first reconciliation incident.
- Risk model is rule-based + explainable — admin sees the flags
  that fired, can dispute the score, can tune the weights without
  retraining a model.
- Seller-response lifecycle preempts the "platform decided
  unilaterally" complaint that's a known dispute-volume driver.
- Replacement / exchange flow is a real product feature, not a
  workaround — customers can swap SKUs without losing money to a
  wallet round-trip.

**Cons:**
- 7 schema migrations is a chunk; rollback story is "drop the
  columns" + redeploy old code. Forward-compatible by design
  (existing rows have NULL on the new columns; legacy paths
  continue to work).
- The dispute and return modules now share the
  `LiabilityParty` / `CustomerRemedy` enums but use them
  through different DTO unions — adding a new value requires
  a careful pass on both sides to avoid TS exhaustiveness drift.
- Per-method refund threshold env keys
  (`REFUND_AUTO_APPROVE_THRESHOLD_PAISE_<METHOD>`) are an
  implicit convention. Documented here; enforcement at parse-
  time would catch typos but isn't critical for a dev knob.

## Future work

- **Dual-admin approval** for high-stakes QC outcomes — the
  `requiresApproval` flag is captured in audit but the second-
  admin enforcement loop (queue + signoff endpoint) is a
  follow-up.
- **Per-route refund threshold UI** — the env-key convention
  works for ops but a settings page would let finance adjust
  without redeploying.
- **Seller wrong-item rate** + **courier damage route pattern**
  risk dimensions — both need cross-customer aggregate queries
  that we don't have a daily-rollup for yet.
- **Liability-ledger admin search UI** — the tables exist and
  are queryable via the ledger services; an admin browser would
  let finance filter by source / amount / date without raw SQL.
- **Per-test schema isolation** for the integration suite so
  parallel runs work in CI.
