import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface DeadLetterFilter {
  eventName?: string;
  aggregate?: string;
  aggregateId?: string;
  page: number;
  limit: number;
}

/**
 * Phase 186 (#8) — operations surface over the outbox dead-letter queue.
 *
 * Before this, rows that exhausted MAX_ATTEMPTS landed in
 * `outbox_dead_letters` with the schema comment "manually replayed or
 * archived" but NO code path to actually do either. This service lets the
 * admin DLQ controller list, inspect and replay them.
 */
@Injectable()
export class OutboxDlqService {
  private readonly logger = new Logger(OutboxDlqService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(filter: DeadLetterFilter) {
    const where: Prisma.OutboxDeadLetterWhereInput = {};
    if (filter.eventName) where.eventName = filter.eventName;
    if (filter.aggregate) where.aggregate = filter.aggregate;
    if (filter.aggregateId) where.aggregateId = filter.aggregateId;
    const skip = (filter.page - 1) * filter.limit;
    const [items, total] = await Promise.all([
      this.prisma.outboxDeadLetter.findMany({
        where,
        orderBy: { deadAt: 'desc' },
        skip,
        take: filter.limit,
      }),
      this.prisma.outboxDeadLetter.count({ where }),
    ]);
    return { items, total, page: filter.page, limit: filter.limit };
  }

  /** Queue-health snapshot for ops dashboards + alerting. */
  async stats() {
    const [pending, retrying, published, deadLetters] = await Promise.all([
      this.prisma.outboxEvent.count({ where: { state: 'PENDING' } }),
      this.prisma.outboxEvent.count({ where: { state: 'RETRYING' } }),
      this.prisma.outboxEvent.count({ where: { state: 'PUBLISHED' } }),
      this.prisma.outboxDeadLetter.count(),
    ]);
    return { pending, retrying, published, deadLetters };
  }

  /**
   * Re-enqueue a dead-lettered event: insert a fresh PENDING outbox row
   * (attempts reset to 0) and remove the dead-letter, atomically. Returns
   * the new outbox event id, or null if the dead-letter no longer exists.
   *
   * `occurredAt` is re-stamped to now() because the dead-letter table
   * doesn't preserve the original (it stores the failure context, not the
   * full event envelope); handlers should treat a replay as a fresh
   * delivery attempt.
   */
  async replay(id: string): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const dl = await tx.outboxDeadLetter.findUnique({ where: { id } });
      if (!dl) return null;
      const created = await tx.outboxEvent.create({
        data: {
          eventName: dl.eventName,
          aggregate: dl.aggregate,
          aggregateId: dl.aggregateId,
          payload: dl.payload as Prisma.InputJsonValue,
          occurredAt: new Date(),
          state: 'PENDING',
          attempts: 0,
          // nextAttemptAt defaults to now() → next tick picks it up.
        },
      });
      await tx.outboxDeadLetter.delete({ where: { id } });
      this.logger.log(
        `Replayed dead-letter ${id} (${dl.eventName}) → new outbox event ${created.id}`,
      );
      return created.id;
    });
  }
}
