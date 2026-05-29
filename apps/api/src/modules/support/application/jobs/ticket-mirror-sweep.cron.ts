import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { DisputesPublicFacade } from '../../../disputes/application/facades/disputes-public.facade';

const BATCH_SIZE = 100;
// Grace period: the inline forward-mirror (in SupportService.reply) is
// near-instant, so anything younger than this is given a chance to land first.
const GRACE_MINUTES = 5;

/**
 * Phase 124 — forward-mirror reliability sweep.
 *
 * When a ticket is promoted to a dispute, a customer/seller reply on the ticket
 * is mirrored into the dispute thread inline (SupportService.reply). That call
 * is best-effort (.catch) — a transient Prisma/network blip leaves the dispute
 * thread missing a customer message, and the admin never sees it.
 *
 * This cron is the safety net. Every 5 minutes it finds non-internal
 * customer/seller ticket messages on promoted tickets, older than the grace
 * window and within the lookback window, that have NO mirrored DisputeMessage,
 * and re-mirrors them. The mirror itself is idempotent (UNIQUE on
 * mirrored_from_ticket_message_id), so even a racing inline-mirror can't
 * produce a duplicate.
 *
 * Multi-replica safe (LeaderElectedCron). Env: SUPPORT_MIRROR_SWEEP_ENABLED
 * (default true), SUPPORT_MIRROR_SWEEP_LOOKBACK_MINUTES (default 120).
 */
@Injectable()
export class TicketMirrorSweepCron {
  private readonly logger = new Logger(TicketMirrorSweepCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
    private readonly disputes: DisputesPublicFacade,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    if (!this.env.getBoolean('SUPPORT_MIRROR_SWEEP_ENABLED', true)) return;
    await this.leader.run('ticket-mirror-sweep', 10 * 60, async () => {
      try {
        await this.instr.wrap('ticket-mirror-sweep', () => this.sweepOnce());
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
    const candidates = await this.prisma.ticketMessage.findMany({
      where: {
        isInternalNote: false,
        senderType: { in: ['CUSTOMER', 'SELLER'] },
        createdAt: {
          gte: new Date(now - lookbackMin * 60 * 1000),
          lt: new Date(now - GRACE_MINUTES * 60 * 1000),
        },
        ticket: { promotedToDisputeId: { not: null } },
      },
      select: {
        id: true,
        senderType: true,
        senderId: true,
        senderName: true,
        body: true,
        ticket: { select: { promotedToDisputeId: true } },
      },
      take: BATCH_SIZE,
      orderBy: { createdAt: 'asc' },
    });

    if (candidates.length === 0) return { scanned: 0, mirrored: 0 };

    let mirrored = 0;
    for (const m of candidates) {
      // Already mirrored? (UNIQUE column → findUnique.) Skip if so.
      const existing = await this.prisma.disputeMessage.findUnique({
        where: { mirroredFromTicketMessageId: m.id },
        select: { id: true },
      });
      if (existing) continue;

      const disputeId = m.ticket?.promotedToDisputeId;
      const senderType = m.senderType === 'SELLER' ? 'SELLER' : 'CUSTOMER';
      if (!disputeId) continue;

      try {
        await this.disputes.mirrorTicketMessageToDispute({
          disputeId,
          sender: { type: senderType, id: m.senderId, name: m.senderName },
          body: m.body,
          sourceTicketMessageId: m.id,
        });
        mirrored++;
      } catch (err) {
        this.logger.error(
          `Re-mirror failed for ticket message ${m.id} → dispute ${disputeId}: ${
            (err as Error).message
          }`,
        );
      }
    }
    if (mirrored > 0) {
      this.logger.warn(
        `Re-mirrored ${mirrored} previously-unmirrored ticket message(s) into disputes`,
      );
    }
    return { scanned: candidates.length, mirrored };
  }
}
