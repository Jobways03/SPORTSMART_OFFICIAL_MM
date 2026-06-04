import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { EnvService } from '../env/env.service';
import { AppLoggerService } from '../logging/app-logger.service';
import { BadRequestAppException } from '../../core/exceptions';
import { DomainEvent } from './domain-event.interface';

/**
 * Two flags drive the publish behaviour during the Phase-2 cutover:
 *
 *   OUTBOX_DUAL_WRITE       direct emit?    write outbox row?    notes
 *   ─────────────────────   ────────────    ──────────────────    ─────────────
 *   false (default)         yes             no                   legacy path; same as pre-Phase-2
 *   true                    yes             yes                  soak window; both paths run
 *   true + OUTBOX_AUTHORITATIVE=true        yes (worker only)    yes  publisher cron is sole emitter; PR 2.5
 *
 * The third row is what we want at steady state — durable delivery
 * with no double-emission. Until then the direct emit path is kept so
 * existing handlers see events even if the publisher worker is paused.
 */
export interface PublishOptions {
  /**
   * Optional Prisma transaction client. Pass it from inside a caller's
   * `prisma.$transaction(async tx => ...)` so the outbox row commits
   * atomically with the aggregate change. Without this the outbox row
   * is written via the global PrismaService (still durable, but loses
   * the all-or-nothing guarantee that's the whole point of the pattern).
   */
  tx?: Prisma.TransactionClient;

  /**
   * Phase 186 (#1) — debounce key. When supplied, a burst of events sharing
   * this key collapses onto ONE pending outbox row: the payload is updated
   * to the latest and the publisher holds delivery until the debounce window
   * closes. Pick a stable per-logical-notification key, e.g.
   * `order-status:<orderId>` or `<recipientId>:<templateKey>`. Without a key
   * every publish is a distinct row (unchanged legacy behaviour).
   */
  dedupeKey?: string;
  /**
   * Debounce window in ms (default `OUTBOX_DEBOUNCE_DEFAULT_MS`). The
   * collapsed row fires this long after the FIRST event in the burst
   * (fixed-window leading-edge — a continuous stream can't starve it).
   */
  debounceWindowMs?: number;

  /** Phase 186 (#5) — future-dated delivery; null/absent = immediate. */
  scheduledAt?: Date;
}

@Injectable()
export class EventBusService {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly logger: AppLoggerService,
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {
    this.logger.setContext('EventBus');
  }

  /**
   * Publish a domain event.
   *
   * Behaviour matrix (see header comment).
   *
   * **Critical invariant**: when `opts.tx` is supplied and OUTBOX_DUAL_WRITE
   * is on, the outbox row commits or rolls back atomically with the caller's
   * transaction. That's the entire reason the outbox pattern exists. Callers
   * who care about durability (refund, dispute decision, settlement) MUST
   * thread the tx through.
   */
  async publish(event: DomainEvent, opts?: PublishOptions): Promise<void> {
    this.logger.log(
      `Publishing ${event.eventName} for ${event.aggregate}:${event.aggregateId}`,
    );

    // Phase 186 (#9) — cap payload size at the write boundary so a runaway
    // handler can't bloat outbox_events row-by-row. Enforced whether or not
    // dual-write is on (it's a programming error either way). A DB CHECK
    // (migration) is the hard backstop at a higher ceiling.
    this.assertPayloadWithinCap(event);

    // Stage 1: write to outbox (if dual-write is on).
    if (this.outboxDualWrite()) {
      try {
        const db = opts?.tx ?? this.prisma;
        if (opts?.dedupeKey) {
          // Phase 186 (#1) — debounce merge: collapse onto a single PENDING
          // row per dedupeKey via INSERT … ON CONFLICT against the partial
          // unique index. Latest payload wins; the fire time stays at the
          // EARLIEST window so a continuous stream can't postpone delivery
          // forever (leading-edge fixed window).
          await this.writeDebouncedRow(db, event, opts);
        } else {
          await db.outboxEvent.create({
            data: {
              eventName: event.eventName,
              aggregate: event.aggregate,
              aggregateId: event.aggregateId,
              payload: (event.payload ?? {}) as Prisma.InputJsonValue,
              occurredAt: event.occurredAt,
              scheduledAt: opts?.scheduledAt ?? null,
              correlationId: event.correlationId ?? null,
              causationId: event.causationId ?? null,
              // state defaults to PENDING; nextAttemptAt defaults to now()
            },
          });
        }
      } catch (err) {
        // Failing here SHOULD propagate when running inside the
        // caller's transaction — the rollback is the whole point.
        // Outside a transaction, log and continue: the direct emit
        // below still ferries the event to listeners (best-effort,
        // legacy semantics).
        if (opts?.tx) {
          throw err;
        }
        this.logger.error(
          `Outbox write failed for ${event.eventName} (${event.aggregate}:${event.aggregateId}): ${
            (err as Error)?.message ?? 'unknown error'
          }. Falling back to direct emit only.`,
        );
      }
    }

    // Stage 2: direct emit (suppressed when outbox is authoritative).
    if (!this.outboxAuthoritative()) {
      queueMicrotask(() => {
        this.eventEmitter
          .emitAsync(event.eventName, event)
          .catch((err) => {
            this.logger.error(
              `Listener failed for ${event.eventName} (${event.aggregate}:${event.aggregateId}): ${
                (err as Error)?.message ?? 'unknown error'
              }`,
            );
          });
      });
    }
  }

  async publishAll(
    events: DomainEvent[],
    opts?: PublishOptions,
  ): Promise<void> {
    for (const event of events) {
      await this.publish(event, opts);
    }
  }

  // ─── Internals ────────────────────────────────────────────────────

  private outboxDualWrite(): boolean {
    return this.env.getBoolean('OUTBOX_DUAL_WRITE', false);
  }

  private outboxAuthoritative(): boolean {
    return this.env.getBoolean('OUTBOX_AUTHORITATIVE', false);
  }

  /**
   * Phase 186 (#9) — reject an over-sized payload at the write boundary.
   * Default 256 KB ceiling (configurable) — generous for any real domain
   * event, tight enough to catch a handler accidentally stuffing a whole
   * result set into the payload. Throws so the caller's transaction rolls
   * back (a too-large payload is a bug, not a transient failure).
   */
  private assertPayloadWithinCap(event: DomainEvent): void {
    const cap = this.env.getNumber('OUTBOX_MAX_PAYLOAD_BYTES', 262_144);
    const bytes = Buffer.byteLength(JSON.stringify(event.payload ?? {}), 'utf8');
    if (bytes > cap) {
      throw new BadRequestAppException(
        `Outbox payload for "${event.eventName}" is ${bytes} bytes, exceeding the ` +
          `${cap}-byte cap. Store large data elsewhere and reference it by id in the event.`,
      );
    }
  }

  /**
   * Phase 186 (#1) — debounce merge. ON CONFLICT against the partial unique
   * index `outbox_events_dedupe_key_pending_uq` (state='PENDING'). Works on
   * both the global client and a transaction client (both expose $executeRaw).
   */
  private async writeDebouncedRow(
    db: PrismaService | Prisma.TransactionClient,
    event: DomainEvent,
    opts: PublishOptions,
  ): Promise<void> {
    const windowMs =
      opts.debounceWindowMs ?? this.env.getNumber('OUTBOX_DEBOUNCE_DEFAULT_MS', 30_000);
    const debounceUntil = new Date(Date.now() + windowMs);
    const payloadJson = JSON.stringify(event.payload ?? {});
    await db.$executeRaw`
      INSERT INTO outbox_events
        (id, event_name, aggregate, aggregate_id, payload, occurred_at,
         dedupe_key, debounce_until, scheduled_at, correlation_id, causation_id,
         state, attempts, next_attempt_at, created_at)
      VALUES
        (${randomUUID()}, ${event.eventName}, ${event.aggregate}, ${event.aggregateId},
         ${payloadJson}::jsonb, ${event.occurredAt},
         ${opts.dedupeKey!}, ${debounceUntil}, ${opts.scheduledAt ?? null},
         ${event.correlationId ?? null}, ${event.causationId ?? null},
         'PENDING', 0, now(), now())
      ON CONFLICT (dedupe_key) WHERE (state = 'PENDING' AND dedupe_key IS NOT NULL)
      DO UPDATE SET
         payload = EXCLUDED.payload,
         occurred_at = EXCLUDED.occurred_at,
         correlation_id = EXCLUDED.correlation_id,
         causation_id = EXCLUDED.causation_id,
         debounce_until = LEAST(outbox_events.debounce_until, EXCLUDED.debounce_until)
    `;
  }
}
