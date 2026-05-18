import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { OutboxEvent } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../cache/redis.service';
import { EnvService } from '../../env/env.service';
import { DomainEvent } from '../domain-event.interface';

/**
 * Phase 2 (PR 2.2) — Outbox publisher worker.
 *
 * Drains `outbox_events` and emits via EventEmitter2 (the same in-process
 * fan-out the legacy direct-publish path uses, so handlers don't change).
 * Backed by a Redis lock so multiple API replicas don't double-emit.
 *
 * Algorithm (one tick):
 *   1. Acquire lock `lock:outbox-publisher` (TTL slightly > batch budget).
 *   2. SELECT … FOR UPDATE SKIP LOCKED LIMIT N — Postgres-native row-level
 *      claim that lets us run multiple publisher instances safely if we
 *      ever go beyond a single replica. (Today a single instance suffices.)
 *   3. For each row, emit via EventEmitter2.emitAsync → await listeners.
 *   4. On listener success: set state=PUBLISHED, publishedAt=now.
 *   5. On listener failure: increment attempts, write lastError,
 *      set nextAttemptAt=now+exp(attempts) (capped at 1h). After
 *      MAX_ATTEMPTS, copy to outbox_dead_letters and remove the source.
 *   6. Release lock.
 *
 * Failure modes:
 *   - Process crash mid-tick: rows revert to PENDING because we wrap
 *     state mutation + publish in a single tx that commits only on
 *     success. (Actually we publish OUTSIDE the tx because emitAsync
 *     can be slow — see comment in `dispatchSingle`.)
 *   - Listener throws: caught at the per-event level so a poison message
 *     doesn't kill the whole batch. Other rows in the batch still process.
 *   - Redis down: skip the tick. Better than emitting twice across replicas.
 *
 * Behaviour at flag-OFF: cron doesn't tick. Outbox grows unbounded if
 * OUTBOX_DUAL_WRITE writes rows but OUTBOX_ENABLED is false — runbook
 * lists this as a misconfiguration to monitor.
 */
@Injectable()
export class OutboxPublisherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OutboxPublisherService.name);
  private static readonly LOCK_KEY = 'lock:outbox-publisher';
  // TTL just bigger than worst-case tick. Don't make it larger or a
  // crashed process holds the lock for too long.
  private static readonly LOCK_TTL_SECONDS = 60;
  // Backoff cap — 1h. After that, slot stays at 1h until MAX_ATTEMPTS.
  private static readonly BACKOFF_CAP_MS = 60 * 60 * 1000;

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly env: EnvService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit(): void {
    if (!this.enabled()) {
      this.logger.log('Outbox publisher disabled (OUTBOX_ENABLED=false)');
      return;
    }
    const intervalMs = this.env.getNumber('OUTBOX_POLL_INTERVAL_MS', 1000);
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error(
          `Outbox tick crashed: ${(err as Error).message}`,
          (err as Error).stack,
        ),
      );
    }, intervalMs);
    this.logger.log(`Outbox publisher started (every ${intervalMs}ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Public so tests + an admin "drain now" endpoint can invoke directly.
   * One tick = pull a batch and process it. Returns the number of rows
   * processed (success + failure).
   */
  async tick(): Promise<number> {
    if (!this.enabled()) return 0;

    // Phase 10 (2026-05-16) — switched from the unfenced acquireLock to
    // the fenced acquireLockWithToken variant. Two problems the fenced
    // version closes:
    //
    //   1. Long-running tick survives a TTL miss: if the batch handlers
    //      take longer than LOCK_TTL_SECONDS, the unfenced release
    //      would delete a successor's lock by name, double-publishing
    //      everything that successor was processing.
    //   2. Mid-tick crash hole: the process can't release a token it
    //      no longer owns, so a successor that acquires after TTL
    //      expiry can't be cleared by a zombie release. The token is
    //      part of the lock value; releaseLockWithToken's Lua script
    //      only deletes when the value matches.
    //
    // Process-crash recovery is still TTL-based: a hard kill leaves
    // the lock keyed for LOCK_TTL_SECONDS. The claim CTE already
    // bumps next_attempt_at by the same TTL so no row is re-claimed
    // before the lock would have expired — meaning a crashed-tick
    // recovers cleanly without duplicate emits.
    const { acquired, token } = await this.redis.acquireLockWithToken(
      OutboxPublisherService.LOCK_KEY,
      OutboxPublisherService.LOCK_TTL_SECONDS,
    );
    if (!acquired || !token) return 0;

    try {
      const rows = await this.claimBatch();
      if (rows.length === 0) return 0;

      // Process events in parallel — each is independent, and emitAsync
      // already serializes within a single event name. Cap concurrency
      // at the batch size; we won't blow up the pool because the batch
      // size is bounded above by OUTBOX_BATCH_SIZE.
      const results = await Promise.allSettled(
        rows.map((row) => this.dispatchSingle(row)),
      );
      // Log a single summary per tick rather than per-row to keep log
      // volume manageable under steady state. Failures already get
      // their own ERROR-level lines from dispatchSingle.
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      this.logger.log(
        `Outbox tick: processed ${rows.length} (${ok} ok, ${rows.length - ok} requeued)`,
      );
      return rows.length;
    } finally {
      // Fenced release: the Lua script atomically deletes ONLY if
      // the lock value still matches our token. If the TTL expired
      // mid-tick and a successor grabbed the lock, this call returns
      // false without touching the successor's lock.
      const released = await this.redis.releaseLockWithToken(
        OutboxPublisherService.LOCK_KEY,
        token,
      );
      if (!released) {
        this.logger.warn(
          'Outbox publisher lock expired before tick finished — a successor may have re-claimed in parallel. ' +
            'Increase OUTBOX_BATCH_SIZE or OUTBOX_POLL_INTERVAL_MS if this happens often.',
        );
      }
    }
  }

  // ─── Internals ────────────────────────────────────────────────────

  private enabled(): boolean {
    return this.env.getBoolean('OUTBOX_ENABLED', false);
  }

  /**
   * Claim a batch of pending rows by transitioning them out of the
   * "ready to publish" predicate atomically. We use UPDATE … RETURNING
   * with a CTE so concurrent ticks (single instance + future multi-replica)
   * never see the same row twice.
   *
   * We don't use `state=PUBLISHING` as an intermediate — we leave the
   * state=PENDING and just bump nextAttemptAt to a far-future time
   * during the in-flight window. If the process crashes, the row's
   * nextAttemptAt rolls back to its previous value and the next tick
   * picks it up. (Postgres updateMany is transactional.)
   *
   * Actually, simpler: we set nextAttemptAt = now + LOCK_TTL on
   * "claim" so a concurrent tick wouldn't pick it up until after the
   * crash window. After successful publish we set state=PUBLISHED.
   * On failure we set nextAttemptAt = now + backoff(attempts).
   */
  private async claimBatch(): Promise<OutboxEvent[]> {
    const batchSize = this.env.getNumber('OUTBOX_BATCH_SIZE', 100);
    const claimUntil = new Date(
      Date.now() + OutboxPublisherService.LOCK_TTL_SECONDS * 1000,
    );

    // CTE-style "select-then-update" with RETURNING. Postgres-specific.
    // The inner SELECT uses FOR UPDATE SKIP LOCKED so multiple ticks
    // never claim the same row.
    return this.prisma.$queryRaw<OutboxEvent[]>`
      WITH claim AS (
        SELECT id FROM outbox_events
         WHERE state = 'PENDING'
           AND next_attempt_at <= now()
         ORDER BY next_attempt_at
         LIMIT ${batchSize}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_events
         SET next_attempt_at = ${claimUntil}
       WHERE id IN (SELECT id FROM claim)
      RETURNING *
    `;
  }

  /**
   * Emit a single event and reconcile state.
   *
   * We emit OUTSIDE any DB transaction because:
   *   - emitAsync awaits listeners (notification email, audit log, etc.)
   *     which can be slow and hold the tx-level lock.
   *   - The atomic guarantee we care about is "the event is committed in
   *     outbox_events before any listener can see it". That holds because
   *     publishers write the row inside their own tx (Phase 2.4 refactor).
   *
   * Failure recovery is via state mutation, not transactions: success →
   * PUBLISHED, failure → backoff, max-attempts → DLQ.
   */
  private async dispatchSingle(row: OutboxEvent): Promise<void> {
    const event: DomainEvent = {
      eventName: row.eventName,
      aggregate: row.aggregate,
      aggregateId: row.aggregateId,
      occurredAt: row.occurredAt,
      payload: row.payload as unknown,
    };
    // The event id is also exposed on the payload so handlers using
    // @IdempotentHandler() can dedupe on it without re-fetching the
    // outbox row. We never overwrite an existing eventId field — if a
    // handler already set one, that's a custom upstream contract.
    if (event.payload && typeof event.payload === 'object') {
      const p = event.payload as Record<string, unknown>;
      if (!('eventId' in p)) p.eventId = row.id;
    }

    try {
      // emitAsync resolves after every listener completes (or rejects).
      // The previous in-process bus dropped the await — we await here
      // because durable delivery means we want to know the listeners
      // didn't blow up before we commit publishedAt.
      await this.eventEmitter.emitAsync(row.eventName, event);
      await this.markPublished(row.id);
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      this.logger.error(
        `Outbox publish failed (${row.eventName}, attempt ${row.attempts + 1}): ${message}`,
      );
      await this.markFailed(row, message);
    }
  }

  private async markPublished(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { state: 'PUBLISHED', publishedAt: new Date() },
    });
  }

  private async markFailed(row: OutboxEvent, errorMessage: string): Promise<void> {
    const newAttempts = row.attempts + 1;
    const maxAttempts = this.env.getNumber('OUTBOX_MAX_ATTEMPTS', 10);

    if (newAttempts >= maxAttempts) {
      // Move to DLQ inside a single tx so we never have a row that's
      // both in outbox_events and outbox_dead_letters.
      await this.prisma.$transaction([
        this.prisma.outboxDeadLetter.create({
          data: {
            outboxEventId: row.id,
            eventName: row.eventName,
            aggregate: row.aggregate,
            aggregateId: row.aggregateId,
            payload: row.payload as never,
            failureReason: errorMessage,
            attempts: newAttempts,
          },
        }),
        this.prisma.outboxEvent.delete({ where: { id: row.id } }),
      ]);
      this.logger.error(
        `Outbox row ${row.id} (${row.eventName}) DLQ'd after ${newAttempts} attempts: ${errorMessage}`,
      );
      return;
    }

    // Exponential backoff with jitter, capped. Jitter avoids thundering
    // herd if the same upstream dependency was the failure cause for a
    // whole batch (e.g. SMTP outage); without jitter the whole batch
    // retries on the same wall-clock tick.
    const baseMs = Math.min(
      1000 * Math.pow(2, newAttempts - 1),
      OutboxPublisherService.BACKOFF_CAP_MS,
    );
    const jitter = Math.floor(Math.random() * 1000);
    const nextAttemptAt = new Date(Date.now() + baseMs + jitter);

    await this.prisma.outboxEvent.update({
      where: { id: row.id },
      data: {
        attempts: newAttempts,
        lastError: errorMessage.slice(0, 1000),
        nextAttemptAt,
      },
    });
  }
}
