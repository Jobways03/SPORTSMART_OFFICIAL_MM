import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotificationsPublicFacade } from '../facades/notifications-public.facade';

interface DiscrepancyFoundPayload {
  runId: string;
  kind: string;
  periodStart: Date;
  periodEnd: Date;
  totalDiscrepancies: number;
  totalExpected: number;
}

/**
 * Fan out a single email per ops admin (SUPER_ADMIN + SELLER_OPERATIONS)
 * when a reconciliation run completes with non-zero discrepancies. Keeps
 * the admin queue from going unwatched.
 *
 * Best-effort: failure here must not affect the recon run itself.
 */
@Injectable()
export class ReconciliationNotificationHandler {
  private readonly logger = new Logger(ReconciliationNotificationHandler.name);

  constructor(
    private readonly notifications: NotificationsPublicFacade,
    private readonly prisma: PrismaService,
    // Phase 2 / M21-M32 — outbox-replay dedup.
    protected readonly eventDedup: EventDeduplicationService,
  ) {}

  @OnEvent('reconciliation.discrepancies.found')
  @IdempotentHandler()
  async onDiscrepanciesFound(event: DomainEvent<DiscrepancyFoundPayload>) {
    const p = event.payload;

    const opsAdmins = await this.prisma.admin.findMany({
      where: {
        status: 'ACTIVE',
        role: { in: ['SUPER_ADMIN', 'SELLER_OPERATIONS'] },
      },
      select: { id: true, email: true },
    });

    if (opsAdmins.length === 0) return;

    const subject = `Reconciliation ${p.kind}: ${p.totalDiscrepancies} discrepancies need review`;
    const body = `
      <p>The latest <strong>${p.kind}</strong> reconciliation run completed with
      <strong>${p.totalDiscrepancies}</strong> discrepancies (out of
      ${p.totalExpected} records inspected).</p>
      <p><strong>Period:</strong>
      ${new Date(p.periodStart).toISOString().slice(0, 10)} →
      ${new Date(p.periodEnd).toISOString().slice(0, 10)}</p>
      <p>Open the run in the admin console to triage:</p>
      <p><a href="/dashboard/reconciliation/${p.runId}">View run</a></p>
    `;

    for (const admin of opsAdmins) {
      try {
        await this.notifications.notify({
          channel: 'EMAIL',
          recipientId: admin.id,
          subject,
          body,
          eventType: 'reconciliation.discrepancies.found',
          eventId: p.runId,
        });
      } catch (err) {
        this.logger.error(
          `Recon notification failed for admin ${admin.id}: ${(err as Error).message}`,
        );
      }
    }
  }
}
