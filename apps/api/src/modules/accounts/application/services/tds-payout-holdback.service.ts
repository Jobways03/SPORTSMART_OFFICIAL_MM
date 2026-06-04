import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';

/**
 * Phase 178 (Outstanding Payables audit #11) — §194-O TDS payout holdback.
 *
 * The settlement-approval TDS hook (SettlementTds194OHookService.
 * applyToCycleOnApprove) stamps every SellerSettlement with EITHER a
 * `tdsLedgerId` (TDS computed) OR a `tdsSkipReason` (EXEMPT / NO_ACTIVITY).
 * A per-seller compute FAILURE leaves a settlement APPROVED with BOTH null —
 * and that settlement must NOT be disbursed, because we cannot lawfully pay an
 * e-commerce participant before §194-O TDS is handled. Today nothing stops the
 * payout flow from picking it up.
 *
 * This guard runs hourly (leader-elected) and:
 *   FREEZE  — any APPROVED, past-due settlement with no `tdsLedgerId` and no
 *             `tdsSkipReason` → ON_HOLD, holdReason TDS_DEPOSIT_PENDING (system
 *             actor, frozenByAdminId null). Already-frozen rows are skipped.
 *   RELEASE — any TDS-held settlement whose TDS has since been handled
 *             (`tdsLedgerId` populated OR `tdsSkipReason` set — e.g. finance
 *             re-ran the compute via the admin endpoint) → back to APPROVED so
 *             the normal payout flow can disburse it.
 *
 * Targeting is precise: in the normal flow EVERY approved settlement carries one
 * of the two markers, so only the TDS-compute-FAILED rows are held — not the
 * whole book. Reversible + idempotent. Bulk CAS so a concurrent admin hold/pay
 * never gets clobbered. Seller-only: §194-O does not apply to franchise payouts.
 *
 * Kill switch: env `TDS_PAYOUT_HOLDBACK_ENABLED` (default true).
 */
export const TDS_HOLD_REASON = 'TDS_DEPOSIT_PENDING';

@Injectable()
export class TdsPayoutHoldbackService {
  private readonly logger = new Logger(TdsPayoutHoldbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
    private readonly leader: LeaderElectedCron,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('TDS_PAYOUT_HOLDBACK_ENABLED', true);
  }

  // Hourly — hold a freshly-due settlement promptly and release it as soon as
  // finance re-runs the TDS compute.
  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('tds-payout-holdback', 30 * 60, async () => {
      try {
        await this.runOnce();
      } catch (err) {
        this.logger.error(`TDS payout holdback run failed: ${(err as Error).message}`);
      }
    });
  }

  /**
   * One freeze+release pass. Exposed for an on-demand admin trigger and tests.
   * Bulk + per-row CAS-guarded; safe to run repeatedly (idempotent).
   */
  async runOnce(now: Date = new Date()): Promise<{ frozen: number; released: number }> {
    // FREEZE — APPROVED + past-due + TDS unhandled + not already frozen.
    const freezeCandidates = await this.prisma.sellerSettlement.findMany({
      where: {
        status: 'APPROVED',
        frozenAt: null,
        payoutDueBy: { lte: now },
        tdsLedgerId: null,
        tdsSkipReason: null,
      },
      select: { id: true },
    });
    const frozenIds: string[] = [];
    for (const r of freezeCandidates) {
      const cas = await this.prisma.sellerSettlement.updateMany({
        where: { id: r.id, status: 'APPROVED', frozenAt: null, tdsLedgerId: null, tdsSkipReason: null },
        data: { status: 'ON_HOLD', frozenAt: now, holdReason: TDS_HOLD_REASON, frozenByAdminId: null },
      });
      if (cas.count === 1) frozenIds.push(r.id);
    }

    // RELEASE — TDS-held settlements whose TDS has since been handled.
    const releaseCandidates = await this.prisma.sellerSettlement.findMany({
      where: {
        status: 'ON_HOLD',
        holdReason: TDS_HOLD_REASON,
        OR: [{ tdsLedgerId: { not: null } }, { tdsSkipReason: { not: null } }],
      },
      select: { id: true },
    });
    const releasedIds: string[] = [];
    for (const r of releaseCandidates) {
      const cas = await this.prisma.sellerSettlement.updateMany({
        where: { id: r.id, status: 'ON_HOLD', holdReason: TDS_HOLD_REASON },
        data: { status: 'APPROVED', frozenAt: null, holdReason: null, frozenByAdminId: null },
      });
      if (cas.count === 1) releasedIds.push(r.id);
    }

    const frozen = frozenIds.length;
    const released = releasedIds.length;
    if (frozen > 0 || released > 0) {
      this.logger.warn(
        `TDS payout holdback: froze ${frozen}, released ${released} seller settlement(s).`,
      );
      try {
        await this.eventBus.publish({
          eventName: 'accounts.tds_payout_holdback',
          aggregate: 'SellerSettlement',
          aggregateId: 'tds-holdback',
          occurredAt: now,
          payload: { frozen, released, frozenIds, releasedIds },
        });
      } catch (err) {
        this.logger.error(
          `Failed to publish accounts.tds_payout_holdback: ${(err as Error).message}`,
        );
      }
    }
    return { frozen, released };
  }
}
