# ADR 017 — Refund finance approval gate

**Status:** Accepted (2026-05-07)
**Phase:** 12 (post-Phase-11)
**Extends:** ADR-016 (dispute liability ledger + RefundInstruction-only money flow)

## Context

ADR-016 routed all dispute-driven wallet credits through
`RefundInstruction → saga → WalletService`, with the saga running
inline at `DisputeService.decide` time. That removed the legacy
direct-wallet path and gave finance a single auditable payable row.
But it left one design question open: **does every `Confirm decision`
click immediately move money?**

Initial answer was **yes** — the admin's decision IS the approval.
That's how Stripe / Shopify / Razorpay's first-party dispute UIs work,
and it's the simplest control: the role holding `disputes.decide`
implicitly holds money-movement authority.

The user pushed back on this with a forward-looking concern:

> "in future i this thing will be based on rbac so no admin will be
> checking"

Translation: once Sportsmart has a real RBAC matrix, the support
agent who decides liability will *not* be the same person who'd
sanity-check the actual wallet credit. The "decision is the approval"
model relies on a single careful gatekeeper — that doesn't survive
segregation of duties.

The fix has to be in the architecture, not in process. Adding it
later means re-plumbing dispute → refund flows after they're
established, which is the kind of audit-trail churn finance teams
hate.

## Decision

Introduce a configurable **finance approval gate** between the
dispute decision and the saga execution.

### Behaviour

- `RefundInstruction.status = PENDING_APPROVAL` is now a real working
  state (the column has existed since `20260505140000` as a forward-
  looking placeholder).
- `DisputeService.decide` calls `RefundInstructionService.createForDispute`
  unchanged; the service decides whether to auto-execute or queue.
- A separate role with `refunds.approve` permission resolves
  `PENDING_APPROVAL` rows via a new admin queue page.

### Threshold rules

```env
REFUND_AUTO_APPROVE_THRESHOLD_PAISE=1000000   # ₹10,000 default
REFUND_GOODWILL_REQUIRES_APPROVAL=true        # always gate goodwill
```

- `amountInPaise > threshold` → **PENDING_APPROVAL** (saga skipped).
- `customerRemedy === GOODWILL_CREDIT` AND
  `REFUND_GOODWILL_REQUIRES_APPROVAL=true` → **PENDING_APPROVAL**
  regardless of amount.
- All other paths → **PROCESSING** + saga runs inline (unchanged).

Goodwill is treated specially because it's a non-recoverable hit to
platform P&L. Even ₹100 goodwill credits accumulate; finance wants to
see them before the wallet moves.

### Approve / reject API

| Method | Path | Permission |
|---|---|---|
| GET | `/admin/refund-instructions?status=PENDING_APPROVAL&page&limit` | `refunds.approve` |
| GET | `/admin/refund-instructions/:id` | `refunds.approve` |
| PATCH | `/admin/refund-instructions/:id/approve` | `refunds.approve` |
| PATCH | `/admin/refund-instructions/:id/reject` (body: `reason`) | `refunds.approve` |

Approve flow: row flips `PENDING_APPROVAL → PROCESSING`, stamps
`approvedBy + approvedAt`, runs the saga, reconciles to `SUCCESS` or
`FAILED`. Idempotent: approving an already-`SUCCESS` row is a no-op.

Reject flow: row flips `PENDING_APPROVAL → CANCELLED`, stamps
`rejectedBy + rejectedAt + rejectionReason`. The dispute decision
itself is **not reversed** — finance can refuse to release the money
without invalidating the support agent's legal-outcome call. Reversing
the dispute is a separate ops action on the dispute page.

### Schema

```prisma
model RefundInstruction {
  status RefundInstructionStatus @default(APPROVED)  // existing
  approvedBy      String?     // existing — was forward-looking
  approvedAt      DateTime?   // existing
  rejectedBy      String?     // NEW (this migration)
  rejectedAt      DateTime?   // NEW
  rejectionReason String?     // NEW
  // ...
}
```

No new enum value required — `PENDING_APPROVAL` was already in
`RefundInstructionStatus`.

### RBAC mapping

| Role | Permissions held | Can decide disputes? | Can release refunds? |
|---|---|---|---|
| `SUPER_ADMIN` | all | ✅ | ✅ |
| Future `SUPPORT_AGENT` | `disputes.decide` | ✅ | ❌ |
| Future `FINANCE_REVIEWER` | `refunds.approve` | ❌ | ✅ |

The same human can hold both today; the architecture is ready for the
moment they're split. To force gating across the board (no auto-path
at all), set `REFUND_AUTO_APPROVE_THRESHOLD_PAISE=0`.

## Consequences

**Pros:**
- Segregation-of-duties primitive in place before RBAC formalises.
- Goodwill spending is reviewable before it hits the books.
- High-value refunds get a second pair of eyes — protects against
  both fraud and admin typos.
- Configurable threshold means low-value refunds still feel instant
  to the customer (no perceived regression today).

**Cons:**
- One more state to test and observe (`PENDING_APPROVAL`).
- High-value cases now have a delay between decision and wallet
  credit. Customer-facing copy on the support ticket may need to
  reflect "your case has been resolved; the refund will be processed
  shortly" rather than "₹X is being credited" when approval is
  pending. **Open question — addressed in a follow-up.**
- Reject doesn't auto-reverse the dispute decision; a leftover
  decided-but-no-money state can confuse customers if not handled
  by ops. Ops runbook entry to follow.

## Failure handling

| Failure | Behaviour |
|---|---|
| Saga fails after approval | Same as today's auto-path: row flips `FAILED`, AdminTask enqueued. |
| Approve called on already-SUCCESS row | No-op return. Idempotent. |
| Approve called on FAILED row | Throws — finance must manually retry via a different ops action. |
| Reject called on already-CANCELLED row | No-op return. |
| Reject with empty reason | Throws — reason (≥3 chars) is required for the audit trail. |

## Acceptance tests (planned)

1. ₹500 dispute decision → saga runs inline → wallet credited (auto-path unchanged).
2. ₹15,000 dispute decision → instruction `PENDING_APPROVAL`; wallet untouched.
3. Approve ₹15,000 instruction → saga runs → wallet credited; row `SUCCESS`.
4. Reject ₹15,000 instruction with reason "investigating fraud" → row `CANCELLED`; wallet untouched; dispute still RESOLVED_BUYER.
5. Goodwill ₹100 → `PENDING_APPROVAL` regardless of threshold.
6. Approve idempotency: calling approve twice on the same row → only one wallet credit (saga's idempotency on `walletTransactions(referenceType, referenceId, type)` UNIQUE).
7. `REFUND_AUTO_APPROVE_THRESHOLD_PAISE=0` → every dispute refund queues; no auto-path.

## Future work

- Make the threshold per-method (e.g. WALLET ₹10k, BANK_TRANSFER ₹0).
- Surface pending-approval state in the customer-facing ticket
  message ("your refund will be processed shortly") instead of
  "credited to your wallet" when applicable.
- Add a "request additional info" action between approve and reject
  for cases where finance needs the support agent to clarify before
  deciding.
