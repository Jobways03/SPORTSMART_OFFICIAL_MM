import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { EnvService } from '../env/env.service';
import { AppLoggerService } from '../logging/app-logger.service';
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

    // Stage 1: write to outbox (if dual-write is on).
    if (this.outboxDualWrite()) {
      try {
        const db = opts?.tx ?? this.prisma;
        await db.outboxEvent.create({
          data: {
            eventName: event.eventName,
            aggregate: event.aggregate,
            aggregateId: event.aggregateId,
            payload: (event.payload ?? {}) as Prisma.InputJsonValue,
            occurredAt: event.occurredAt,
            // state defaults to PENDING; nextAttemptAt defaults to now()
          },
        });
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
}
