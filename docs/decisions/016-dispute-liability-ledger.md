# ADR 016 — Dispute liability ledger + RefundInstruction-only money flow

**Status:** Accepted (2026-05-07)
**Phase:** 12 (post-Phase-11)
**Supersedes (in part):** ADR-009 §"Dispute → Wallet direct credit fallback"

## Context

The Phase 3 unified-refund work (ADR-009) split refund execution into a
`RefundInstruction → saga → WalletService` chain, but kept a **legacy
direct-wallet path** in `DisputeRefundHandler` for the case where
`REFUND_INSTRUCTION_REQUIRED=false`. The intent at the time was a soft
cutover; in practice the legacy branch lingered, conflated decision +
execution, and provided no auditable payable-obligation row.

The Phase 11 ticket-to-dispute rebrand added a new failure mode: when
the customer's only window is a support ticket, finance / ops have
nowhere to record **who pays** for a refund. We were also creating
disputes with no liability attribution at all — a buyer-favoured
outcome could be funded by goodwill, by recovering from the seller, or
by recovering from the courier, but the data didn't capture which.

The user mandated an industry-grade redesign with explicit separation
of concerns:

> Wallet credit must still happen, but not directly from DisputeService
> or DisputeRefundHandler.

## Decision

### Money-flow contract

```
DisputeService.decide()
  ↓ writes liabilityParty + customerRemedy on Dispute
  ↓ creates RefundInstruction (when customer is owed money)
  ↓ writes ONE liability-ledger row (SellerDebit | LogisticsClaim | PlatformExpense)
  ↓ updates linked Return status (DISPUTE_OVERTURNED | _PARTIAL_OVERRIDE | _CONFIRMED | GOODWILL_CREDITED)
                ↓
RefundInstruction
  ↓ saga executes
                ↓
WalletService.creditFromRefund()
  ↓ idempotent on (referenceType, referenceId, type)
                ↓
Customer wallet credited
```

**`DisputeRefundHandler` is deleted.** The handler's saga branch is now
called inline from `DisputeService.decide`. The legacy direct-wallet
branch is gone entirely.

### Schema

```prisma
enum LiabilityParty { NONE SELLER LOGISTICS PLATFORM CUSTOMER }
enum CustomerRemedy { FULL_REFUND PARTIAL_REFUND NO_REFUND GOODWILL_CREDIT }

model Dispute {
  liabilityParty  LiabilityParty?
  customerRemedy  CustomerRemedy?
  // ...
}

model SellerDebit {
  sourceType   LedgerSourceType        // DISPUTE | RETURN | MANUAL
  sourceId     String                  // dispute.id / return.id
  status       SellerDebitStatus       // PENDING | APPLIED | CANCELLED
  amountInPaise BigInt
  // @@unique([sourceType, sourceId])
}

model LogisticsClaim {
  sourceType  LedgerSourceType
  sourceId    String
  courierName String?
  awbNumber   String?
  status      LogisticsClaimStatus    // PENDING → SUBMITTED → ACCEPTED → RECOVERED | REJECTED
  amountInPaise BigInt
  // @@unique([sourceType, sourceId])
}

model PlatformExpense {
  sourceType   LedgerSourceType
  sourceId     String
  expenseType  PlatformExpenseType    // GOODWILL | PLATFORM_FAULT | EXCEPTION | ROUNDING_ADJUSTMENT
  amountInPaise BigInt
  // @@unique([sourceType, sourceId])
}

model AdminTask {
  kind        AdminTaskKind            // REFUND_INSTRUCTION_FAILED | LOGISTICS_CLAIM_REVIEW | SELLER_DEBIT_DISPUTED | OTHER
  status      AdminTaskStatus          // OPEN | CLAIMED | RESOLVED | CANCELLED
  // @@unique([kind, sourceType, sourceId])
}
```

New `ReturnStatus` values: `DISPUTE_OVERTURNED`, `DISPUTE_PARTIAL_OVERRIDE`,
`DISPUTE_CONFIRMED`, `GOODWILL_CREDITED`. FSM updated to allow
`QC_REJECTED → any of the four`, `PARTIALLY_APPROVED → DISPUTE_OVERTURNED |
_PARTIAL_OVERRIDE`, and `COMPLETED → DISPUTE_OVERTURNED |
_PARTIAL_OVERRIDE` (post-refund corrections).

### Decision matrix

| Outcome | CustomerRemedy | LiabilityParty | RefundInstruction | Ledger row | Linked-Return status |
|---|---|---|---|---|---|
| `RESOLVED_BUYER` | `FULL_REFUND` | `SELLER` | yes (full) | `SellerDebit` | `DISPUTE_OVERTURNED` |
| `RESOLVED_BUYER` | `FULL_REFUND` | `LOGISTICS` | yes (full) | `LogisticsClaim` | `DISPUTE_OVERTURNED` |
| `RESOLVED_BUYER` | `FULL_REFUND` | `PLATFORM` | yes (full) | `PlatformExpense (PLATFORM_FAULT)` | `DISPUTE_OVERTURNED` |
| `RESOLVED_BUYER` | `GOODWILL_CREDIT` | `PLATFORM` | yes | `PlatformExpense (GOODWILL)` | `GOODWILL_CREDITED` |
| `RESOLVED_SPLIT` | `PARTIAL_REFUND` | `SELLER` | yes (partial) | `SellerDebit (partial)` | `DISPUTE_PARTIAL_OVERRIDE` |
| `RESOLVED_SPLIT` | `PARTIAL_REFUND` | `LOGISTICS` | yes (partial) | `LogisticsClaim (partial)` | `DISPUTE_PARTIAL_OVERRIDE` |
| `RESOLVED_SPLIT` | `PARTIAL_REFUND` | `PLATFORM` | yes (partial) | `PlatformExpense (PLATFORM_FAULT)` | `DISPUTE_PARTIAL_OVERRIDE` |
| `RESOLVED_SELLER` | `NO_REFUND` | `CUSTOMER` | no | none (commission released) | `DISPUTE_CONFIRMED` |
| `RESOLVED_SELLER` | `NO_REFUND` | `NONE` | no | none | `DISPUTE_CONFIRMED` |

`validateDecisionMatrix()` rejects any other combination at the service
boundary before the dispute write.

### Idempotency contract

Three layers protect against double-credit on saga / event retries:

1. **`RefundInstruction.idempotencyKey = "dispute:<id>"`** — UNIQUE; the
   same dispute id can never spawn two instructions.
2. **`WalletTransaction (referenceType, referenceId, type)`** UNIQUE — the
   wallet credit step is itself idempotent.
3. **Liability ledger `(sourceType, sourceId)`** UNIQUE on each table —
   saga retries that try to write the same `SellerDebit` /
   `LogisticsClaim` / `PlatformExpense` twice hit the constraint and
   the service returns the existing row.

### Failure handling

| Failure | Behaviour |
|---|---|
| RefundInstruction creation fails | Dispute decision stands; `AdminTask(REFUND_INSTRUCTION_FAILED)` enqueued; ops retries from queue. |
| RefundInstruction saga fails (wallet step) | Instruction marked `FAILED`; AdminTask enqueued by saga. |
| Liability-ledger write fails | Dispute decision stands; `AdminTask(OTHER)` enqueued. |
| FSM rejects linked-return transition | Logged warning; dispute decision stands. The return's old status is allowed to drift (rare; surfaces in reconciliation cron). |

## Consequences

**Pros:**
- Audit trail: every refund traces to a `RefundInstruction` row before
  any wallet movement. Finance can answer "what's owed and to whom?"
  from a single table.
- Cost attribution: `SellerDebit` / `LogisticsClaim` / `PlatformExpense`
  let finance build P&L for disputes by liability party.
- Decision vs. execution separated — adding a new payment method
  (UPI refund, bank transfer) plugs in at the saga, not at the dispute
  service.
- Future seller-portal "your debits" view + courier claims dashboard
  fall out for free.

**Cons:**
- Decide endpoint payload widened: clients must now send
  `liabilityParty` + `customerRemedy`. Migration script for the admin
  storefront landed in the same PR.
- One extra DB write per decision (the ledger row). Acceptable — these
  are admin-frequency events, not request-path.
- `LogisticsClaim` is loosely coupled to courier identity (free-text
  `courierName`). When/if a couriers table lands, normalise.

## Alternatives considered

1. **Keep the legacy direct-wallet path behind a flag.** Rejected — the
   user explicitly mandated removal; finance + audit team need the
   payable row regardless.
2. **One unified `LiabilityRecord` table with `kind` discriminator.**
   Rejected — each ledger has different lifecycle and recovery model
   (settlement / claim API / no recovery). Polymorphic table would
   bloat with kind-specific columns.
3. **Compute liability from existing CommissionReversalRecord +
   PlatformExpense (no SellerDebit).** Rejected — return-driven
   reversals are item-level; dispute-driven debits are
   resolution-level. Different cardinality + semantics; conflating
   makes the settlement run brittle.

## Acceptance tests

The 6 cases from the user's spec are encoded as integration-test
plans (see `apps/api/test/integration/dispute-liability-flow.spec.ts`
when implemented). Summary:

1. Buyer-favoured + SELLER → RefundInstruction (full) + SellerDebit;
   dispute service does NOT call `WalletPublicFacade` directly;
   linked return = `DISPUTE_OVERTURNED`.
2. Partial refund + SELLER → RefundInstruction (partial) +
   SellerDebit (partial); linked return = `DISPUTE_PARTIAL_OVERRIDE`.
3. Buyer-favoured + LOGISTICS → RefundInstruction + LogisticsClaim;
   no SellerDebit.
4. Goodwill + PLATFORM → RefundInstruction + PlatformExpense
   (`expenseType=GOODWILL`); no SellerDebit, no LogisticsClaim;
   linked return = `GOODWILL_CREDITED`.
5. Seller-favoured + CUSTOMER → no RefundInstruction, no wallet
   credit, commission released if `ON_HOLD`; linked return =
   `DISPUTE_CONFIRMED`.
6. Duplicate processing (same dispute decided / event replayed) →
   only one wallet credit, only one ledger row, only one
   `RefundInstruction`.
