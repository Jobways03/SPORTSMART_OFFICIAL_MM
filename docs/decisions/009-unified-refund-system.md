# ADR-009: Unified Refund System (RefundInstruction + Saga + Wallet Idempotency + Reconciliation)

**Status**: Accepted

**Date**: 2026-05-05

**Phase**: 3 (PRs 3.1-3.6) of the 10-phase Returns + Disputes redesign

## Context

Today's reality (mapped in the Phase 0 trace):

* `DisputeRefundHandler.onDecided` calls `WalletPublicFacade.creditFromRefund` directly. A buyer-favoured dispute decision becomes a wallet credit with no persisted "this is a refund" record — only the `WalletTransaction` row, with `referenceId = "dispute:<id>"`.
* `ReturnService.initiateRefund` branches on the order's payment method into wallet credit (sync), Razorpay refund (async), or COD manual processing. Each branch writes its own bookkeeping (`RefundTransaction` rows for Razorpay, nothing extra for wallet).
* No central log of "which refunds are happening, in what state, owed to whom." Finance reconciliation has to sum across `WalletTransaction` and `RefundTransaction` and Razorpay GETs.
* Wallet credits are nominally idempotent at the application layer (`WalletPublicFacade.creditFromRefund` accepts a `refundId` reference), but nothing at the DB level prevented two writes with the same reference. A retried event = double credit.
* A failed dispute wallet credit is logged-and-swallowed by the handler. The customer is owed money the system can't see.

Phase 3 fixes all four. Every refund — return, dispute, goodwill, manual, COD, replacement — first creates a `RefundInstruction` row. The Saga executor drives it through forward steps, with compensations on failure. The wallet's natural-key UNIQUE makes credits truly idempotent. Reconciliation crons surface drift to ops.

## Decision

Six PRs — schema → idempotency → executor → instruction creator → recon → method selection.

| PR | Lands |
|---|---|
| **3.1** | `refund_instructions` + `refund_sagas` tables + 4 new enums. |
| **3.2** | `wallet_transactions @@unique([referenceType, referenceId, type])`. `WalletService.credit` short-circuits on existing reference; recovers from P2002 race. |
| **3.3** | `RefundSagaService.run(input)` — persisted SAGA executor with compensations. Flag-OFF runs steps inline without persistence. |
| **3.4** | `RefundInstructionService.createForDispute()` + `DisputeRefundHandler.onDecided` refactor to call it (legacy path preserved when flag OFF). |
| **3.5** | Three recon crons: wallet-ledger drift, refund-gateway stuck, COD-refund-pending. Each independently flagged. |
| **3.6** | `RefundMethodSelector.select(input)` — deterministic method picker per the brief's rules. |

### Five flags

| Flag | Effect | Default |
|---|---|---|
| `REFUND_INSTRUCTION_REQUIRED` | Refunds create instructions instead of direct wallet credits. | false |
| `REFUND_SAGA_ENABLED` | Saga state persisted to `refund_sagas`. | false |
| `WALLET_LEDGER_RECON_ENABLED` | Nightly drift check. | false |
| `REFUND_GATEWAY_RECON_ENABLED` | Hourly stuck-refund check. | false |
| `COD_REFUND_PENDING_ENABLED` | 4-hourly aged-MANUAL_REQUIRED check. | false |

`WalletService` idempotency (PR 3.2) is unconditional — the unique index is the source of truth. The flag-protected migration path is the application-side fast-path lookup, and that's safe to ship without a flag because it's pure read-side optimization.

### The Phase-3 refund flow (flag-ON)

```
Dispute decided (RESOLVED_BUYER, ₹50 to wallet)
  │
  ▼  outbox writes 'disputes.decided' in tx with the dispute update (Phase 2)
  │
  publisher cron emits to listeners
  │
  ▼  DisputeRefundHandler.onDecided
  │   - @IdempotentHandler (Phase 2) — first time only
  │   - REFUND_INSTRUCTION_REQUIRED → call RefundInstructionService.createForDispute
  │
  ▼  RefundInstructionService
  │   - findUnique on idempotencyKey — returns existing if replayed
  │   - prisma.refundInstruction.create(status=PROCESSING)
  │   - sagaService.run(steps=[walletCreditStep])
  │
  ▼  RefundSagaService
  │   - persist saga row
  │   - run walletCreditStep:
  │       walletFacade.creditFromRefund({ refundId: instruction.id })
  │       → WalletService.credit
  │           → findTransactionByReference (PR 3.2 fast-path)
  │           → repo.applyMutation (with @@unique on (referenceType, referenceId, type))
  │           → P2002 → look up winner → return existing
  │   - persist saga COMPLETED
  │
  ▼  RefundInstructionService reconciles
      - update instruction → SUCCESS, walletTransactionId, processedAt
```

A retry / replay of `disputes.decided` produces no new state because:

1. `@IdempotentHandler` short-circuits at the dedup table.
2. `RefundInstructionService.createForDispute` finds the existing instruction by idempotencyKey.
3. `WalletService.credit` finds the existing wallet transaction by reference.

Three layers of idempotency, defence in depth.

### Compensation semantics

The wallet-credit step's compensation INTENTIONALLY throws "manual review required" rather than auto-debiting. A wallet rollback is a financial reversal we don't want to do silently — the saga records the failed compensation in `refund_sagas.compensations`, the instruction goes to FAILED, and the recon cron surfaces it to ops. Phase 5 may revisit this when we add an explicit `wallet.creditReversal` flow.

### Why polymorphic-by-id rather than FK relations

`RefundInstruction.sourceType + sourceId` (and the same on `RefundSaga`) deliberately avoid Prisma `@relation` declarations. ADR-001 (strict modular monolith) rules: cross-module FKs are forbidden. The refund-instructions module shouldn't have a hard schema dependency on disputes or returns. Idempotency lives on the natural keys, not on relational joins.

### Reconciliation cron strategy

Three jobs, three different runtimes:

* **Wallet-ledger drift** — daily 03:00 IST after settlements close. Catches "somebody bypassed the service" or rare bugs. Highest signal value.
* **Refund-gateway stuck** — hourly. Catches Razorpay refunds in PROCESSING > 24h that the publisher cron hasn't auto-confirmed.
* **COD pending aged** — 4-hourly. Catches MANUAL_REQUIRED rows older than 48h that ops forgot to wire.

Each emits a domain event on drift; Phase 8 wires those events to PagerDuty + Slack.

## Consequences

### Positive

* **Audit trail per refund** — finance can answer "what's the status of this customer's ₹500" with a single `SELECT FROM refund_instructions`.
* **No more silent failures** — a failed dispute refund lives as `RefundInstruction.status='FAILED'` with `failureReason`, not as a swallowed log line.
* **DB-level idempotency** — wallet can't double-credit even if every layer above it is buggy.
* **Replays are safe** — three independent dedup checkpoints (event handler, instruction lookup, wallet lookup).
* **Drift detection** — the nightly wallet recon catches manual SQL gone wrong within 24h instead of "the customer escalated three weeks later."

### Negative / costs

* **Three new tables** + their indexes. Marginal — they grow with refund volume, not with traffic.
* **Saga overhead** — every refund pays one extra DB write per step plus the saga row. Measured at <50ms per refund e2e in benchmark.
* **Refactoring tail** — only DisputeRefundHandler is migrated in Phase 3. ReturnService.initiateRefund and the goodwill admin endpoint use the legacy path until Phase 5 / a follow-up touches them. Documented; flag-gated; tracked.
* **Compensation isn't fully automatic** — wallet credit's compensation requires manual ops review. Better than auto-reversing money silently, but worth callout.

### Risks and rollback

* **Risk**: existing duplicate `WalletTransaction` rows would block the unique-index migration. PR 3.2 documents the audit query and explicitly leaves the migration to fail loudly so ops dedupes first. Refused to ship a `CREATE UNIQUE INDEX CONCURRENTLY ... NULLS DISTINCT` workaround.
* **Risk**: a bug in the saga executor leaves an instruction stuck in PROCESSING. Mitigation: PR 3.5's wallet-ledger recon catches the resulting wallet imbalance even if the instruction state is wrong.
* **Risk**: the dispute handler's flag-on path AND the legacy path both fire for the same event. Mitigated: when REFUND_INSTRUCTION_REQUIRED=true, the handler RETURNS after the instruction call (success or fail), never falling through to legacy. Tested.
* **Rollback**: flip `REFUND_INSTRUCTION_REQUIRED=false`. Dispute decisions resume the legacy direct-credit path. RefundInstruction rows already created stay in their final states; the recon cron surfaces any inconsistencies.

## Alternatives considered

* **Use Temporal / Inngest as the workflow engine.** Adds infra. Our scale doesn't justify it yet. The custom saga executor in PR 3.3 is ~250 lines and covers our needs through Phase 5.
* **Direct-write refund table without saga** (status-machine on the row itself). Simpler, but couples retry logic with the row's lifecycle and makes per-step compensations awkward.
* **Make the unique index cover all transactions** (`@@unique([walletId, referenceType, referenceId, type])`). The natural key the service treats as idempotent is `(referenceType, referenceId, type)` — same reference shouldn't appear twice across two wallets either. We chose the cross-wallet variant. Reconsidered Phase 5 if multi-wallet money flows become a thing.
* **Fail-open compensation** (auto-debit the wallet on saga failure). Refused — silent financial reversals violate the audit-trail principle the whole phase exists to support.

## References

- Caitie McCaffrey, "Distributed Sagas": https://www.youtube.com/watch?v=0UTOLRTwOX0
- Microservices.io — Saga pattern: https://microservices.io/patterns/data/saga.html
- ADR-008 — Transactional Outbox (this phase builds on outbox semantics).
- Code: `apps/api/src/modules/refund-instructions/`, `apps/api/src/modules/payments-saga/`, `apps/api/src/modules/reconciliation/application/jobs/`
- Phase 3 implementation across PRs 3.1-3.6.
