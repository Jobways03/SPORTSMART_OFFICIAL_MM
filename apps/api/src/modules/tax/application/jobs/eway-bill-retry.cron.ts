// Phase 89 (2026-05-23) — Shipment Evidence audit Gap #10 / #23.
//
// EWB retry sweep. Pre-Phase-89 FAILED rows accumulated forever; the
// partial index `e_way_bills_retry_idx` existed but no processor ran
// against it. This cron picks up FAILED rows with retry_count below
// the configured ceiling and re-attempts generation through the same
// EWayBillService.generate path (so audit + events fire identically).
//
// Backoff: each row has its own `retry_count` — the sweep just calls
// generate and lets the provider response decide. A separate backoff
// window would be added once we observe real failure-rate patterns
// (out of scope for the audit closure).
//
// Once retry_count >= max, raise an AdminTask with kind
// EWAY_BILL_GENERATION_FAILED so the ops dashboard surfaces the
// stuck row.

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { TaxConfigService } from '../services/tax-config.service';
import { EWayBillService } from '../services/eway-bill.service';

@Injectable()
export class EWayBillRetryCron {
  private readonly logger = new Logger(EWayBillRetryCron.name);
  private static readonly BATCH = 25;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leader: LeaderElectedCron,
    private readonly taxConfig: TaxConfigService,
    private readonly eway: EWayBillService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    await this.leader.run('eway-bill-retry', 1800, async () => {
      const maxRetries = await this.taxConfig.getNumber(
        'eway_bill_max_retries',
        6,
      );
      const candidates = await this.prisma.eWayBill.findMany({
        where: { status: 'FAILED', retryCount: { lt: maxRetries } },
        select: { id: true, subOrderId: true, retryCount: true },
        take: EWayBillRetryCron.BATCH,
        orderBy: { updatedAt: 'asc' },
      });
      if (candidates.length === 0) return;

      let succeeded = 0;
      let stillFailing = 0;
      for (const row of candidates) {
        try {
          await this.eway.generate(row.subOrderId);
          succeeded += 1;
        } catch (err) {
          stillFailing += 1;
          this.logger.warn(
            `EWB retry still failing for sub-order ${row.subOrderId} (attempt ${
              row.retryCount + 1
            }): ${(err as Error).message}`,
          );
        }
      }

      // Phase 89 — raise AdminTask for rows that hit max retries.
      const exhausted = await this.prisma.eWayBill.findMany({
        where: { status: 'FAILED', retryCount: { gte: maxRetries } },
        select: { id: true, subOrderId: true, failureReason: true },
        take: EWayBillRetryCron.BATCH,
      });
      for (const ewb of exhausted) {
        try {
          await (this.prisma as any).adminTask.upsert({
            where: { uniqueKey: `eway-bill-failed:${ewb.id}` },
            update: {},
            create: {
              kind: 'EWAY_BILL_GENERATION_FAILED',
              uniqueKey: `eway-bill-failed:${ewb.id}`,
              severity: 'HIGH',
              status: 'OPEN',
              title: `EWB generation exhausted retries (sub-order ${ewb.subOrderId})`,
              details: ewb.failureReason ?? 'See e_way_bill row for details',
              relatedResource: 'eway_bill',
              relatedResourceId: ewb.id,
            },
          });
        } catch (err) {
          this.logger.error(
            `Failed to raise AdminTask for EWB ${ewb.id}: ${(err as Error).message}`,
          );
        }
      }

      // Phase 160 (cancel/override audit B1/#18) — reconcile stuck cancels.
      // A row in CANCELLATION_PENDING (the two-phase marker was written but
      // the provider call / settle didn't complete) or CANCELLATION_FAILED
      // is re-driven via the idempotent EWayBillService.cancel path: NIC's
      // cancel is idempotent, so a retry settles the row to CANCELLED (or
      // leaves it FAILED for the next sweep / an AdminTask).
      const reconcile = await this.reconcileStuckCancellations();

      this.logger.log(
        `EWB retry sweep: ${succeeded} succeeded, ${stillFailing} still failing, ` +
          `${exhausted.length} task(s) raised; cancel-reconcile: ${reconcile.healed} healed, ${reconcile.stuck} stuck`,
      );
    });
  }

  /**
   * Phase 160 (audit B1/#18) — heal two-phase-cancel drift. Re-drives
   * CANCELLATION_PENDING / CANCELLATION_FAILED rows through the idempotent
   * cancel path; raises an AdminTask for rows that stay stuck.
   */
  private async reconcileStuckCancellations(): Promise<{ healed: number; stuck: number }> {
    const stuck = await this.prisma.eWayBill.findMany({
      where: { status: { in: ['CANCELLATION_PENDING', 'CANCELLATION_FAILED'] } },
      select: {
        id: true,
        cancelInitiatedBy: true,
        cancellationReason: true,
      },
      take: EWayBillRetryCron.BATCH,
      orderBy: { updatedAt: 'asc' },
    });
    let healed = 0;
    let stillStuck = 0;
    for (const row of stuck) {
      try {
        await this.eway.cancel({
          ewbId: row.id,
          cancelledBy: row.cancelInitiatedBy ?? 'system-reconcile',
          reason: row.cancellationReason ?? 'Reconcile stuck cancellation',
        });
        healed += 1;
      } catch (err) {
        stillStuck += 1;
        // Surface a persistently-stuck cancel for ops (idempotent task).
        try {
          await (this.prisma as any).adminTask.upsert({
            where: { uniqueKey: `eway-bill-cancel-stuck:${row.id}` },
            update: {},
            create: {
              kind: 'EWAY_BILL_GENERATION_FAILED',
              uniqueKey: `eway-bill-cancel-stuck:${row.id}`,
              severity: 'HIGH',
              status: 'OPEN',
              title: `EWB cancellation stuck — local says cancelling, NIC state unconfirmed (${row.id})`,
              details: (err as Error).message ?? 'See e_way_bill row',
              relatedResource: 'eway_bill',
              relatedResourceId: row.id,
            },
          });
        } catch {
          /* task-raise failure must not abort the sweep */
        }
      }
    }
    return { healed, stuck: stillStuck };
  }
}
