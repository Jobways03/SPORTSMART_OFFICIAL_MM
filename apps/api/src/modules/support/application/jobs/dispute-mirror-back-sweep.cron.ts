import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { SupportService } from '../services/support.service';

const BATCH_SIZE = 100;
const GRACE_MINUTES = 5;

/**
 * Phase 124 — back-mirror reliability sweep (dispute → ticket), the symmetric
 * counterpart to TicketMirrorSweepCron.
 *
 * Admin replies on a promoted dispute are mirrored back onto the customer's
 * ticket by DisputeMirrorHandler (an @IdempotentHandler on disputes.message.added).
 * That handler is replay-safe, but if event delivery succeeds and the ticket-side
 * Prisma write fails, the error is logged and forgotten — the customer never
 * sees that admin reply on their ticket.
 *
 * This cron recovers those: every 5 min it finds non-internal ADMIN dispute
 * messages on disputes promoted from a ticket, within the lookback window, that
 * have NO mirrored TicketMessage, and re-mirrors them. mirrorDisputeMessageToTicket
 * is idempotent (UNIQUE on mirrored_from_dispute_message_id), so a racing handler
 * can't double-post. Reuses SUPPORT_MIRROR_SWEEP_ENABLED / _LOOKBACK_MINUTES.
 */
@Injectable()
export class DisputeMirrorBackSweepCron {
  private readonly logger = new Logger(DisputeMirrorBackSweepCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
    private readonly support: SupportService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    if (!this.env.getBoolean('SUPPORT_MIRROR_SWEEP_ENABLED', true)) return;
    await this.leader.run('dispute-mirror-back-sweep', 10 * 60, async () => {
      try {
        await this.instr.wrap('dispute-mirror-back-sweep', () =>
          this.sweepOnce(),
        );
      } catch {
        // already recorded as FAILED in cron_runs
      }
    });
  }

  private async sweepOnce(): Promise<{ scanned: number; mirrored: number }> {
    const now = Date.now();
    const lookbackMin = this.env.getNumber(
      'SUPPORT_MIRROR_SWEEP_LOOKBACK_MINUTES',
      120,
    );
    // Only ADMIN, non-internal messages back-mirror (the handler's rule:
    // customer/seller dispute messages arrived via the forward mirror, and
    // internal notes never leave the dispute).
    const candidates = await this.prisma.disputeMessage.findMany({
      where: {
        senderType: 'ADMIN',
        isInternalNote: false,
        createdAt: {
          gte: new Date(now - lookbackMin * 60 * 1000),
          lt: new Date(now - GRACE_MINUTES * 60 * 1000),
        },
        dispute: { sourceTicketId: { not: null } },
      },
      select: {
        id: true,
        senderId: true,
        body: true,
        dispute: { select: { sourceTicketId: true } },
      },
      take: BATCH_SIZE,
      orderBy: { createdAt: 'asc' },
    });

    if (candidates.length === 0) return { scanned: 0, mirrored: 0 };

    let mirrored = 0;
    for (const dm of candidates) {
      const existing = await this.prisma.ticketMessage.findUnique({
        where: { mirroredFromDisputeMessageId: dm.id },
        select: { id: true },
      });
      if (existing) continue;

      const ticketId = dm.dispute?.sourceTicketId;
      if (!ticketId) continue;

      try {
        await this.support.mirrorDisputeMessageToTicket({
          ticketId,
          body: dm.body,
          adminId: dm.senderId,
          sourceDisputeMessageId: dm.id,
        });
        mirrored++;
      } catch (err) {
        this.logger.error(
          `Re-mirror failed for dispute message ${dm.id} → ticket ${ticketId}: ${
            (err as Error).message
          }`,
        );
      }
    }
    if (mirrored > 0) {
      this.logger.warn(
        `Re-mirrored ${mirrored} previously-unmirrored admin dispute reply(ies) back to tickets`,
      );
    }
    return { scanned: candidates.length, mirrored };
  }
}
