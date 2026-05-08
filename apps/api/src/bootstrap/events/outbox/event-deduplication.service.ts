import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { EnvService } from '../../env/env.service';
import { DomainEvent } from '../domain-event.interface';

/**
 * Phase 2 (PR 2.3) — Handler-side event deduplication.
 *
 * The publisher delivers at-least-once. Handlers that mutate state
 * (refund credit, audit row insert, notification email) need
 * exactly-once semantics. This service makes that effective with a
 * single atomic INSERT into event_deduplication keyed on
 * (eventId, handlerName):
 *
 *   - First invocation: INSERT succeeds → return true → handler runs.
 *   - Replay: INSERT fails with P2002 → return false → handler skips.
 *
 * Why a separate service rather than coupling to OutboxPublisher:
 *   - Some handlers don't go through the outbox (legacy direct-bus
 *     callers during the dual-write window). They still want dedup.
 *   - Tests can mock this without dragging the publisher in.
 *
 * Behaviour at flag-OFF: tryConsume always returns true. Handlers run
 * every time they receive an event (today's behaviour).
 */
@Injectable()
export class EventDeduplicationService {
  private readonly logger = new Logger(EventDeduplicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  /**
   * Try to claim an (event, handler) tuple. Returns true if the caller
   * should proceed (first time), false if it should skip (duplicate).
   *
   * Falls back gracefully when the event payload doesn't carry an
   * `eventId` — that happens during PR 2.4's dual-write window for
   * events emitted by the legacy direct-bus path. We synthesize a
   * stable id from `${aggregate}:${aggregateId}:${eventName}:${occurredAt.ms}`
   * which is good enough for dedup against same-event replays but
   * NOT cross-handler deduplication.
   */
  async tryConsume(
    event: DomainEvent,
    handlerName: string,
  ): Promise<boolean> {
    if (!this.enabled()) return true;

    const eventId = this.extractEventId(event);
    try {
      await this.prisma.eventDeduplication.create({
        data: {
          eventId,
          handler: handlerName,
        },
      });
      return true;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Already consumed — skip.
        this.logger.debug(
          `dedup skip: ${handlerName} already consumed event ${eventId}`,
        );
        return false;
      }
      // Any other error: log and fail open. Letting the handler run on
      // a write failure is safer than silently dropping a money-moving
      // event because the dedup table was momentarily unavailable.
      this.logger.error(
        `dedup write failed for ${handlerName}/${eventId}: ${(err as Error).message} — proceeding without dedup`,
      );
      return true;
    }
  }

  /**
   * Reverse a consumed marker. Used by tests + ops "replay this event"
   * tooling. NOT exposed via any public route — operations that touch
   * money should never replay without a deliberate human action.
   */
  async release(eventId: string, handlerName: string): Promise<void> {
    await this.prisma.eventDeduplication.deleteMany({
      where: { eventId, handler: handlerName },
    });
  }

  // ─── Internals ────────────────────────────────────────────────────

  private enabled(): boolean {
    return this.env.getBoolean('EVENT_DEDUP_ENABLED', false);
  }

  private extractEventId(event: DomainEvent): string {
    const p = event.payload as { eventId?: unknown } | null;
    if (p && typeof p === 'object' && typeof p.eventId === 'string') {
      return p.eventId;
    }
    // Synthetic stable id. Two emissions of the SAME event with the
    // same occurredAt timestamp will collide; that's the desired
    // dedup behaviour. Different physical events that happen at the
    // same millisecond would also collide — an acceptable false
    // positive given the alternative is duplicate side effects.
    return `${event.aggregate}:${event.aggregateId}:${event.eventName}:${event.occurredAt.getTime()}`;
  }
}
