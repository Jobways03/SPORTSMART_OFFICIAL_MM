// Phase 88 (2026-05-23) — Shipment Evidence Gap #9 / DPDP retention.
//
// Pre-Phase-88 shipment evidence lived in media forever — no
// process pruned photos after the dispute window closed. DPDP §8(7)
// requires "no longer than necessary" retention; the platform
// defaults to 180 days post-delivery (configurable per policy).
//
// The cron runs once daily, leader-elected:
//   1. Find ShipmentEvidence rows with retention_expires_at < NOW()
//      AND deleted_at IS NULL.
//   2. Soft-delete each row (PURGED action in the audit chain) so the
//      audit log preserves the lifecycle even after the asset is gone.
//   3. TODO: hand off the media publicId to the asset-GC queue
//      (separate cron deletes the underlying file). Out of scope for
//      this cron — DB-side purge is the auditable boundary.
//
// Holds-on-dispute: an active Return / TicketDispute referencing
// the sub-order sets retention_expires_at = NULL while the case is
// open; this cron skips NULL values.

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';

@Injectable()
export class ShipmentEvidenceRetentionCron {
  private readonly logger = new Logger(ShipmentEvidenceRetentionCron.name);
  private static readonly BATCH = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leader: LeaderElectedCron,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async sweep(): Promise<void> {
    await this.leader.run('shipment-evidence-retention', 3600, async () => {
      const now = new Date();
      let totalPurged = 0;
      while (true) {
        const expired = await this.prisma.shipmentEvidence.findMany({
          where: {
            retentionExpiresAt: { lt: now },
            deletedAt: null,
          },
          select: { id: true, subOrderId: true, kind: true },
          take: ShipmentEvidenceRetentionCron.BATCH,
        });
        if (expired.length === 0) break;

        for (const row of expired) {
          try {
            await this.prisma.$transaction(async (tx: any) => {
              await tx.shipmentEvidence.update({
                where: { id: row.id },
                data: {
                  deletedAt: now,
                  deletedBy: 'retention-cron',
                  deletedReason: 'Auto-purge: retention window expired',
                },
              });
              await tx.shipmentEvidenceAudit.create({
                data: {
                  shipmentEvidenceId: row.id,
                  action: 'PURGED',
                  actorId: 'retention-cron',
                  actorRole: 'SYSTEM',
                  reason: 'Auto-purge: retention window expired',
                },
              });
            });
            totalPurged += 1;
          } catch (err) {
            this.logger.error(
              `Failed to purge evidence ${row.id}: ${(err as Error).message}`,
            );
          }
        }

        if (expired.length < ShipmentEvidenceRetentionCron.BATCH) break;
      }
      if (totalPurged > 0) {
        this.logger.log(`Auto-purged ${totalPurged} expired evidence row(s)`);
      }
    });
  }
}
