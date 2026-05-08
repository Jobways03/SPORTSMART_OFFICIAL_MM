# ADR-008: Transactional Outbox for Domain Events

**Status**: Accepted

**Date**: 2026-05-05

**Phase**: 2 (PRs 2.1-2.5) of the 10-phase Returns + Disputes redesign

## Context

Today's `EventBusService` is the canonical "easy in-process bus":

```ts
// pre-Phase-2
async publish(event) {
  queueMicrotask(() => eventEmitter.emitAsync(event.eventName, event).catch(logErr));
}
```

Two acknowledged failure modes:

1. **Crash between commit and emit.** A handler that decides a dispute commits the row, then the API process is restarted (deploy, OOM, ECS scaling). The `disputes.decided` event is queued in microtask but the emit never fires — `DisputeRefundHandler.onDecided` never runs — wallet credit is silently lost. Customer is owed money the system can't see.

2. **Listener error swallowed.** Even with the catch, listeners run async; once they throw, retry is the application's problem, not the bus's.

For non-money events (notifications, search reindex) the cost of (1) is irritation. For money events (`disputes.decided`, `returns.refund.completed`, `wallet.credited`, `commission.reversed`, `seller.activated`) the cost is real-world refund / payout drift, the kind of thing finance operations escalate to engineering at 11pm.

## Decision

Implement the **Transactional Outbox** pattern (Microservices.io, Chris Richardson 2018) over a five-PR cutover.

### The contract

1. Domain events are persisted in an `outbox_events` row in the **same DB transaction** that mutates the aggregate.
2. A separate publisher worker drains the outbox every ~1s, emitting via the existing `EventEmitter2` to existing handlers.
3. Handlers wrap themselves in `@IdempotentHandler` (or call `EventDeduplicationService.tryConsume`) so at-least-once delivery becomes effectively exactly-once at the handler boundary.
4. After `OUTBOX_MAX_ATTEMPTS` (default 10) a row moves to `outbox_dead_letters` for manual replay.

### Five-PR cutover

| PR | Lands | Risk |
|---|---|---|
| **2.1** | Schema: `outbox_events`, `outbox_dead_letters`, `event_deduplication`. Pure additive — no behaviour change. | None |
| **2.2** | `OutboxPublisherService` — Redis-locked cron, batches via `FOR UPDATE SKIP LOCKED`, exp-backoff with jitter. Default OFF (`OUTBOX_ENABLED=false`). | None at flag-OFF |
| **2.3** | `EventDeduplicationService` + `@IdempotentHandler()` decorator. Wired on `DisputeRefundHandler.onDecided`. Default OFF. | None at flag-OFF |
| **2.4** | `EventBusService.publish(event, { tx })` accepts a Prisma tx and writes outbox row inside it when `OUTBOX_DUAL_WRITE=true`. Direct emit path retained for backward compat during soak. `DisputeService.decide` refactored as the canonical caller. | Medium (tx semantics) |
| **2.5** | Env safety interlocks — refuse boot if `OUTBOX_AUTHORITATIVE=true` without both `OUTBOX_ENABLED` and `OUTBOX_DUAL_WRITE`. Once flipped on, publisher cron is sole emitter. | High at flag-flip |

### Flag matrix (steady-state goal)

| Flag | Soak (week 1-2) | Steady state |
|---|---|---|
| `OUTBOX_ENABLED` | true (publisher cron drains rows) | true |
| `OUTBOX_DUAL_WRITE` | true (rows are written; legacy direct-emit also runs) | true |
| `OUTBOX_AUTHORITATIVE` | false (both paths active during soak) | true (publisher is sole emitter) |
| `EVENT_DEDUP_ENABLED` | true | true |

### Schema choices

- **`outbox_events.payload` is JSONB.** Lets the publisher emit any DomainEvent shape without per-event type metadata. The handler still validates the payload against its declared interface.
- **Composite PK on `event_deduplication (eventId, handler)`.** Lookup is the hot path; no surrogate id needed.
- **`outbox_dead_letters` is a separate table, not a `state=DEAD` flag.** Splitting tables means the hot publisher query (`WHERE state='PENDING' AND nextAttemptAt <= now()`) doesn't have to filter past DLQ'd rows; the DLQ table accumulates indefinitely without bloating the publisher path.

### Algorithm: claim batch via FOR UPDATE SKIP LOCKED

```sql
WITH claim AS (
  SELECT id FROM outbox_events
   WHERE state = 'PENDING' AND next_attempt_at <= now()
   ORDER BY next_attempt_at
   LIMIT $1
   FOR UPDATE SKIP LOCKED
)
UPDATE outbox_events SET next_attempt_at = $2  -- claim window
 WHERE id IN (SELECT id FROM claim)
RETURNING *
```

`FOR UPDATE SKIP LOCKED` is the Postgres-native way to give multiple concurrent publishers (single replica today, multi-replica tomorrow) batch-disjoint claims without an external coordinator. The Redis lock is a coarser-grain mutex that prevents two ticks of the SAME publisher from racing — a defence in depth.

### Backoff with jitter

Failures double the next-attempt delay (1s → 2s → 4s → … capped at 1h) plus 0-1s of jitter. Without jitter, an upstream blip (SMTP outage, DB lock contention) causes the entire batch to retry on the same wall-clock tick, which keeps the upstream pinned. With jitter, retries spread out and the system self-recovers.

### When `tx` is supplied vs not

`EventBusService.publish(event, opts?)`:

| `opts.tx` | dual-write on | outbox-write fails | direct emit |
|---|---|---|---|
| supplied | yes | **PROPAGATES** (rollback the caller's tx) | runs (unless authoritative) |
| undefined | yes | logged + swallowed (caller already committed) | runs |
| supplied | no | n/a | runs |
| undefined | no | n/a | runs |

The "propagates with tx" semantic is the entire point. A caller who threads the tx is opting into atomicity: "either both the dispute decision AND the event are committed, or neither is."

The "swallowed without tx" semantic is the safety net for legacy callers who haven't been refactored yet — their behaviour stays "best-effort emit", same as today.

## Consequences

### Positive

- **Money events are durable.** A crash between dispute decision and event publish becomes a benign "event still pending in outbox; publisher will pick it up on restart."
- **Handler exactly-once via dedup.** Wallet credit handler can't double-credit on at-least-once redelivery.
- **Foundation for Phase 3** (Refund Saga). The saga's compensation logic emits events at every step; durable delivery is the difference between a recoverable saga and an inconsistent one.
- **Foundation for Phase 7-10** (observability / public API / webhooks). The outbox row IS the wire format for an outgoing webhook later.
- **Boot-time safety**: misconfigured env that would silently drop events is rejected by the env-schema validator.

### Negative / costs

- **Two writes per event** during dual-write soak: outbox row + (eventually) listener side-effect. Soak window only — flips off once authoritative.
- **Publisher latency adds ~1s to listener side-effects.** A 1s notification email becomes a 2s notification email. Acceptable for our use cases; tune `OUTBOX_POLL_INTERVAL_MS` down if needed.
- **Tx-threading is invasive.** Every caller that wants atomic outbox-write must thread the tx through. Phase 2 only refactors `DisputeService.decide` as the demo; the long tail (return service, settlement processor, refund gateway) ports as Phase 3-5 touch them anyway. Until then, those callers get durable-but-not-strictly-atomic outbox writes.

### Risks and rollback

- **Risk**: Publisher worker is paused for an extended period (e.g., infra outage). Outbox rows accumulate; once the worker restarts it processes them, but listeners (notifications) might fire in a burst. Mitigation: rate-limit OUTBOX_BATCH_SIZE down for the first 5 minutes after a restart. Phase 8 dashboard adds a "publisher lag" gauge.
- **Risk**: A pathological listener that always fails moves a row to DLQ then keeps failing on every replay. Mitigation: DLQ replay is manual — ops opens the dead-letter, fixes the root cause, then runs a one-shot replay command (Phase 8).
- **Rollback**: flip `OUTBOX_AUTHORITATIVE=false`. Direct emit comes back; outbox keeps writing rows in dual-write mode. Drain or stop the publisher with `OUTBOX_ENABLED=false`. Schema persists indefinitely.

## Alternatives considered

- **Postgres `LISTEN/NOTIFY`.** Tempting — built-in pub/sub. But it's not durable: a listener missed during disconnection loses messages. Plus the payload size cap (8000 bytes) is too small for our event shapes.
- **External queue** (Kafka, RabbitMQ, SQS). Adds infra to operate. The outbox + Postgres polling gets us 80% of the durability for ~5% of the operational cost. Phase 10's webhook system might later relay outbox → Kafka if we go multi-region.
- **Debezium-style CDC** (binary log capture). Overkill at our scale; couples ourselves to a particular Postgres replication topology.
- **Synchronous emit inside the tx.** Couples handler latency to publisher latency — a slow listener would block the dispute decision response. Refused.

## References

- Chris Richardson, *Microservices.io* — Transactional Outbox: https://microservices.io/patterns/data/transactional-outbox.html
- "Distributed Transactions: The Saga Pattern" (Caitie McCaffrey)
- Postgres `FOR UPDATE SKIP LOCKED` semantics: https://www.postgresql.org/docs/current/explicit-locking.html
- Phase 2 implementation: `apps/api/src/bootstrap/events/outbox/`
- Code: `event-bus.service.ts`, `outbox-publisher.service.ts`, `event-deduplication.service.ts`, `idempotent-handler.decorator.ts`
