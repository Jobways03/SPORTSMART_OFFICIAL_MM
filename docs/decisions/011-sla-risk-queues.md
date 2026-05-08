# ADR-011: SLA tracking, risk scoring, and unified queues

**Status**: Accepted

**Date**: 2026-05-05

**Phase**: 6 (PRs 6.1–6.5) of the 10-phase Returns + Disputes redesign

## Context

Pre-Phase-6 reality:

* **No SLAs.** A dispute that lands in `UNDER_REVIEW` and never gets touched
  again sits there forever; the only escape valve is an admin spotting it
  in the list view. Same for returns stuck in `REQUESTED`, tickets in
  `OPEN`. We discovered this after a dispute aged 47 days unresolved
  during the Phase 0 audit.
* **No risk score.** Every case looks the same to the queue UI. A
  ₹50,000 changed-mind return from a flagged repeat-returner sorts the
  same as a ₹500 defective return from a first-time buyer.
* **Three siloed lists.** Returns, disputes, and tickets each have
  their own admin list page, sorted by `createdAt DESC`. Ops asks
  "what should I work on next?" and nothing in the system answers it.

Phase 6 closes all three with three layered tables (`sla_policies`,
`sla_breaches`, `risk_scores`) and a unified queue API on top.

## Decision

Five PRs:

| PR | Lands |
|---|---|
| **6.1** | `sla_policies` + `sla_breaches` tables, `SlaTrackerService` (pure-ish: snapshots × policies → verdicts). |
| **6.2** | `SlaBreachDetectorCron` (5-min cadence, idempotent upsert), `SlaEscalationService` with three tactics (REASSIGN_SENIOR / BOOST_SEVERITY / NOTIFY_MANAGER), env flag `SLA_BREACH_DETECTOR_ENABLED`. |
| **6.3** | `risk_scores` table, `RiskScoreCalculator` (linear weights, hand-tuned), `RiskScoreService`. |
| **6.4** | `QueueService` + `AdminQueuesController` exposing `GET /admin/queues/{return,dispute,ticket}` + `/admin/queues/summary`. |
| **6.5** | `seed-sla-policies.ts` (illustrative defaults), this ADR, runbook (`phase-6-sla-cutover.md`). |

### Why three tables, not one

We considered collapsing SLA + risk into a single `case_priority` table.
Rejected because the lifecycles are independent:

* `sla_policies` are slow-moving config (admin edits when SLAs change
  team-by-team). `risk_scores` are per-resource dynamic state.
* A breach has its own state machine (open → escalated → resolved)
  that doesn't apply to risk scores at all.
* Joining at read time via `QueueService` is a 1:1 lookup keyed on
  `(resourceType, resourceId)` — fast, cheap, and lets us version
  the two halves independently.

### Status-change timestamps

The breach detector needs to know when a case entered its current
status. Three options:

1. Add a dedicated `statusEnteredAt` column to each domain model
   (Return, Dispute, Ticket).
2. Use the existing status-history table (Returns has one; Disputes
   and Tickets don't).
3. Approximate with `updatedAt` / `lastMessageAt`.

We picked **(3)** for v1. The 5-minute cron cadence bounds the
inaccuracy. A non-status update that resets the timer (e.g. a dispute
gets a new message) is a known limitation called out in the cron's
comments and in this ADR. v2 (Phase 7+) will introduce a dedicated
column under the same migration that adds dispute status history.

### Risk model — linear weights, hand-tuned

We considered training a small classifier on historical fraud labels.
Rejected for now:

* Insufficient labelled data — fraud-confirmed returns are <0.1% of
  the corpus and the labels are stale.
* Reviewers need to be able to answer "why did this case score 75?"
  to a customer. A linear model produces "abuser flag (30) + amount
  tier (40) + manual refund method (15) = 85", which is
  reviewer-explainable. A model that says "the network said so" is
  not.

Weights live in code (`RiskScoreCalculator`) so changes are
version-controlled. ML can ride on top later as an additional signal
when we have ground truth.

### Queue sort order

Single, opinionated key:

```
ORDER BY sla_remaining_minutes ASC,
         risk_score DESC,
         created_at ASC
```

Rationale:

* SLA first because a breach is a hard commitment to the customer or
  team. A high-risk case still inside its SLA can wait; a low-risk
  case past its deadline cannot.
* Risk second to break ties within the same urgency band.
* `createdAt ASC` last so two equal cases are FIFO — fair to whoever
  filed first.

The UI exposes filters (`onlyBreaching`, `minTier`) but no
sort-customisation. Keeping the order consistent across reviewers
prevents "I worked the queue differently and missed a breach".

### Three flags, one detector

| Flag | Default | Effect when ON |
|---|---|---|
| `SLA_BREACH_DETECTOR_ENABLED` | `false` | The cron runs every 5 minutes, writes breach rows, fires escalations. |
| (none for risk) | risk scores compute on demand whenever `RiskScoreService.recompute` is called — no global flag needed because the calculator is stateless and pure. | |
| (none for queues) | the queue API is read-only and works whether or not breaches are populated. | |

The deliberate single flag mirrors Phase 4: the risky moving parts
(actually mutating dispute.severity, clearing assignedAdminId) are
guarded by one explicit switch.

## Consequences

* Ops gets one queue. The three siloed lists remain (the UI doesn't
  delete pages on day one) but the new `/admin/queues/*` endpoints are
  the recommended view from Phase 6 forward.
* Adding a new SLA is a row insert, no code change.
* Risk weights need versioning when we tune them. We treat changes to
  `RiskScoreCalculator` like commission-formula changes (covered by
  ADR-009 alongside): a tuning change should bump test fixtures and
  document the before/after distribution.
* Tracking breaches in their own table means we can compute "breach
  rate by team" and "average minutes overdue" trivially. Both are
  table stakes for the next ops review.
* Approximating `enteredStatusAt` with `updatedAt` for disputes and
  tickets is a known v1 limitation (see Status-change timestamps
  section). Treat any inaccuracy <5min as expected.

## Alternatives considered

* **Reuse the existing event bus to drive escalations** — would couple
  the SLA cron to the outbox cutover state. Rejected so the SLA layer
  ships independently of Phase 2 progress.
* **Per-domain SLA tables** (returns_sla_policies, disputes_sla_policies)
  — three tables to maintain three migrations. Single
  `sla_policies` keyed on `(resourceType, status)` is a tiny
  generalisation that pays off in a single dashboard.
* **MongoDB-style queues with priority** — we already have Postgres,
  the row counts are bounded, and a SELECT-with-ORDER-BY is good
  enough at our scale. Revisit if/when the queue grows past a few
  hundred thousand active rows.

## Migration / rollout

* Apply migrations 20260505200000 (SLA tables) + 20260505210000 (risk
  scores).
* Run `pnpm --filter @apps/api exec ts-node prisma/seed/seed-sla-policies.ts`
  to install the example deadlines. Review and edit before flipping.
* Soak `SLA_BREACH_DETECTOR_ENABLED=false` for at least one week,
  watching the queue UI in dev/staging. The breach detector populates
  no rows during this window — we're checking the SLA *verdict* math
  in the queue UI alone.
* Flip `SLA_BREACH_DETECTOR_ENABLED=true` in staging. Verify the
  detector populates `sla_breaches` correctly and escalations fire as
  expected.
* Repeat in production. Rollback is a single env-var flip.
* Risk scores: no flag — they compute opportunistically. Hook the
  calculator into return/dispute creation in a follow-up sub-PR (the
  hooks aren't in this PR set; we landed the infrastructure here so
  the queue UI has something to read once the hooks ship).
* Operational runbook: [docs/runbooks/phase-6-sla-cutover.md](../runbooks/phase-6-sla-cutover.md).
