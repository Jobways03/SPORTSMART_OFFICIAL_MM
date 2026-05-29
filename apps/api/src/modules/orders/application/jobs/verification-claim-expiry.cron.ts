import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

/**
 * Phase 73 (2026-05-22) — claim-flow audit Gap #4.
 *
 * Pre-Phase-73 expired claims were "released" only lazily, when
 * the next `claim-next` call hit the queue and the OR-condition
 * `claim_expires_at < NOW()` made the row eligible again. The
 * `claimed_by_admin_id` / `claimed_at` / `claim_expires_at`
 * columns were never NULLed for an order that no one re-claimed —
 * team-status JOINed admins on stale rows, audit queries couldn't
 * tell whether a claim had expired or was still alive, and the
 * claim history table never received TTL_EXPIRY rows.
 *
 * The cron runs every 5 minutes, leader-elected:
 *   1. Find every master_orders row where `claim_expires_at < NOW()`
 *      AND `claimed_by_admin_id IS NOT NULL` (still has a stale claim).
 *   2. INSERT OrderClaimHistory rows with reason = TTL_EXPIRY.
 *   3. UPDATE master_orders → NULL the three claim columns.
 *   4. Emit orders.claim.expired event per row + write audit log.
 *
 * Batched (default 500 rows / tick) so a sudden backlog doesn't
 * blow up the cron's runtime; the next tick mops up the rest.
 */
@Injectable()
export class VerificationClaimExpiryCron {
  private readonly logger = new Logger(VerificationClaimExpiryCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
    private readonly leader: LeaderElectedCron,
    private readonly audit: AuditPublicFacade,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('VERIFICATION_CLAIM_EXPIRY_ENABLED', true);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('verification-claim-expiry', 10 * 60, async () => {
      try {
        await this.runOnce();
      } catch (err) {
        this.logger.error(
          `Claim expiry sweep failed: ${(err as Error).message}`,
        );
      }
    });
  }

  /**
   * Testable inner loop. Returns the count of released claims so
   * the test harness can assert without inspecting prisma directly.
   */
  async runOnce(): Promise<{ released: number }> {
    const batchLimit = this.env.getNumber(
      'VERIFICATION_CLAIM_EXPIRY_BATCH_LIMIT',
      500,
    );
    const now = new Date();
    const candidates = await this.prisma.masterOrder.findMany({
      where: {
        claimedByAdminId: { not: null },
        claimExpiresAt: { lt: now },
      },
      select: {
        id: true,
        orderNumber: true,
        claimedByAdminId: true,
        claimedAt: true,
        claimExpiresAt: true,
      },
      take: batchLimit,
    });
    if (candidates.length === 0) return { released: 0 };

    let released = 0;
    for (const row of candidates) {
      const claimedAt = row.claimedAt ?? row.claimExpiresAt ?? now;
      const durationSeconds = Math.max(
        0,
        Math.round((now.getTime() - claimedAt.getTime()) / 1000),
      );
      try {
        // Status-conditional update — if a fresh claim came in
        // between our findMany and this update (another verifier
        // claim-next), updateMany returns count=0 and we skip the
        // history/event for that row.
        const result = await this.prisma.$transaction(async (tx) => {
          const updated = await tx.masterOrder.updateMany({
            where: {
              id: row.id,
              claimedByAdminId: row.claimedByAdminId,
              claimExpiresAt: { lt: now },
            },
            data: {
              claimedByAdminId: null,
              claimedAt: null,
              claimExpiresAt: null,
            },
          });
          if (updated.count === 0) return false;
          await tx.orderClaimHistory.create({
            data: {
              masterOrderId: row.id,
              claimedByAdminId: row.claimedByAdminId,
              claimedAt,
              durationSeconds,
              releaseReason: 'TTL_EXPIRY',
              releasedByAdminId: null, // cron-driven, no human actor
            },
          });
          return true;
        });
        if (!result) continue;
        released++;

        this.eventBus
          .publish({
            eventName: 'orders.claim.expired',
            aggregate: 'MasterOrder',
            aggregateId: row.id,
            occurredAt: new Date(),
            payload: {
              masterOrderId: row.id,
              orderNumber: row.orderNumber,
              claimedByAdminId: row.claimedByAdminId,
              durationSeconds,
            },
          })
          .catch(() => undefined);
        this.audit
          .writeAuditLog({
            actorRole: 'SYSTEM',
            action: 'ORDER_CLAIM_EXPIRED',
            module: 'orders',
            resource: 'master_order',
            resourceId: row.id,
            metadata: {
              orderNumber: row.orderNumber,
              previousAdminId: row.claimedByAdminId,
              durationSeconds,
              expiredAt: row.claimExpiresAt?.toISOString() ?? null,
            },
          })
          .catch(() => undefined);
      } catch (err) {
        this.logger.warn(
          `Failed to expire claim on order ${row.id}: ${(err as Error).message}`,
        );
      }
    }
    if (released > 0) {
      this.logger.log(
        `Verification claim expiry — released ${released}/${candidates.length} stale claim(s)`,
      );
    }
    return { released };
  }
}
