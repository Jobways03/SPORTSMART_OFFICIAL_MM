# ADR-006: Business-Duplicate Prevention for Returns / Disputes / Tickets

**Status**: Accepted

**Date**: 2026-05-05

**Phase**: 1.5 of the 10-phase Returns + Disputes redesign

## Context

Idempotency keys (ADR-003) protect against the **same request** being delivered twice. They don't catch the **distinct-request-same-business-meaning** failure mode:

* Customer files a return for `orderItem-A`. A week later, a different mobile session files another. Two returns for the same item now exist; QC opens both; commission gets reversed twice.
* Customer files a dispute citing a return. Loses patience and files a second dispute on the same return from the web. Now there are two dispute threads, two assigned admins, two decisions in flight.
* Same-order, same-issue support ticket gets reopened by the customer five times because they hit "Contact Support" from each email; admin queue floods with duplicates.

The brief explicitly calls out four uniqueness rules. None can be expressed as a simple Postgres unique constraint because the "active" predicate excludes terminal statuses, and Postgres partial unique indexes can't reference values across joined tables (return-status lives on `Return`, the natural key on `ReturnItem`).

## Decision

Application-level duplicate check at the four create entry points. Centralised in `CaseDuplicateService` so the rules live in one file. Audit-logged to a new `case_duplicates` table for support visibility. Behind `CASE_DUPLICATE_PREVENTION_ENABLED` (default OFF) for the dual-write soak.

### The four rules

| # | Rule | Active predicate | Entry point |
|---|---|---|---|
| R1 | One active return per `orderItemId` | `Return.status NOT IN (CANCELLED, REJECTED, COMPLETED, REFUNDED)` | `ReturnEligibilityService.validateReturnRequest` |
| R2 | One active dispute per `returnId` | `Dispute.status NOT IN (CLOSED, RESOLVED_*)` | `DisputeService.fileDispute` (when `returnId` provided) |
| R3 | One active dispute per `(masterOrderId, kind)` | same | `DisputeService.fileDispute` (when `masterOrderId` provided) |
| R4 | One active ticket per `(relatedOrderId, categoryId)` | `Ticket.status NOT IN (CLOSED)` (RESOLVED stays "active" so customers can re-open) | `SupportService.createTicket` |

R4 supports an admin override (`allowDuplicate: true`) — sometimes a customer has a legitimate second complaint under the same category on the same order; admins judge.

### Audit table

`case_duplicates` records every rejection: who tried, the natural key they used, the existing case they collided with, and which rule fired. Lets support answer "who's repeatedly hitting the duplicate rule?" and "is the rule too aggressive on category X?".

```prisma
model CaseDuplicate {
  attemptedSourceType   RETURN | DISPUTE | TICKET
  attemptedNaturalKey   Json    // e.g. { orderItemId: "..." }
  duplicateOfSourceType RETURN | DISPUTE | TICKET
  duplicateOfSourceId   String
  reason                String  // e.g. ACTIVE_RETURN_EXISTS_FOR_ORDER_ITEM
  actorType, actorId
  createdAt
}
```

### Race semantics — known + accepted

This is a SELECT-then-throw check, so two concurrent creates can BOTH pass the duplicate check and produce two cases. Why this is acceptable for Phase 1:

* The case-number sequences (`returnNumber`, `disputeNumber`, `ticketNumber`) are still uniquely allocated, so the system stays internally consistent.
* The 95th-percentile attempt path is human-paced (customer clicks "Submit") with seconds between collision candidates — the race window is too narrow to cover legitimate retries.
* The pathological case (programmatic abuse) is bounded at 2 cases, not unbounded; admin can cancel the duplicate manually.

If we later need stronger guarantees, two paths:

* **Postgres advisory lock** keyed on the natural key — `pg_advisory_xact_lock(hashtext('return-create:' || orderItemId))`. Tightens the window to a single transaction.
* **Denormalised active-key column** with a partial unique index. Higher schema cost; better correctness.

Both are documented in the runbook for the day Phase 5 makes the rule load-bearing.

### Why a service flag rather than a code switch

Same reasoning as PR 1.1 / 1.3: ship the path now, validate behaviour in staging, flip the flag. Lets us collect rejection rates from `case_duplicates` and tune the rules (e.g. should R4 also key on `relatedReturnId`? Phase 5 calls).

## Consequences

### Positive

* Fixes the four documented duplicate-case scenarios from the redesign brief.
* `case_duplicates` audit gives ops a real signal on duplicate-attempt frequency — useful for sizing customer-facing UX (e.g. if the rate spikes, the original confirmation page isn't loud enough).
* Sets up Phase 5 (lifecycle hardening): the dispute reconciliation logic in §5.1 needs to know when a return already has an active dispute. Same query, reused.
* Foundation for Phase 6 (risk scoring): repeated duplicate attempts from one customer are a signal worth weighting.

### Negative / costs

* One extra DB roundtrip per create (4 services × ~hundred-millisecond p99 reads). Below the noise floor.
* Rules drift risk: if Phase 5 adds new statuses (e.g. `DISPUTE_OVERTURNED` from §5.1), the inactive-status lists must be updated in `CaseDuplicateService` AND the runbook AND the tests. A regression here is silent — the rule simply stops firing. Mitigated by integration tests in Phase 5 that assert "filing a dispute against a return whose previous dispute resolved as buyer-favoured succeeds".
* Race acceptance described above.

### Risks and rollback

* **Rollback**: set `CASE_DUPLICATE_PREVENTION_ENABLED=false`. No schema rollback. The audit table can stay; it's strictly additive.
* **Risk**: false positives during a status-enum migration (e.g., a Phase 5 rename of `RESOLVED_BUYER → BUYER_FAVOURED` would make the inactive list stale, causing the rule to admit duplicates). Mitigation: ADR-008 (Phase 5) will explicitly call out updating this rule.

## Alternatives considered

* **Postgres partial unique index**. Couldn't express "active across joined tables" without a denormalised column.
* **Database trigger**. Hides logic from app developers; harder to test; harder to evolve.
* **Just rely on idempotency keys**. Doesn't address the "different keys, same business intent" pattern (mobile app retry vs customer manually re-submitting from a different device).
* **Block at controller level via a `@DeduplicateBy()` decorator**. Cute but couples the rule definitions to HTTP routes; the same business rule applies to both customer-facing and admin-facing creation paths.

## References

* Phase 1.5 of the Returns + Disputes redesign brief.
* `apps/api/src/core/case-duplicate/case-duplicate.service.ts` — rule definitions live here.
* `apps/api/test/unit/case-duplicate-service.spec.ts` — pinning test for each rule.
