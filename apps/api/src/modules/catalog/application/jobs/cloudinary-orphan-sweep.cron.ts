import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { CloudinaryAdapter } from '../../../../integrations/cloudinary/cloudinary.adapter';

/**
 * Phase 14 (2026-05-16) — Cloudinary orphan sweep.
 *
 * When a Product is soft-deleted we set `isDeleted=true, deletedAt=now()`
 * but its `ProductImage` / `ProductVariantImage` rows stay around for
 * the configured retention window. After the window expires, the
 * customer's right-to-be-forgotten under DPDP §6 requires us to drop
 * both the DB rows AND the Cloudinary assets — otherwise an attacker
 * with a leaked Cloudinary publicId could still pull the image months
 * after deletion.
 *
 * The sweep runs daily, leader-elected, and processes a bounded batch
 * per tick. For each image row whose parent Product was soft-deleted
 * more than `CLOUDINARY_ORPHAN_RETENTION_DAYS` ago:
 *
 *   1. Call `cloudinary.delete(publicId)` — best-effort; Cloudinary
 *      returning "not found" is success (already gone).
 *   2. Delete the DB row.
 *   3. Both fail-paths log + skip; the next tick retries.
 *
 * Why DB-row deletion (vs. soft-delete the image too): once the
 * Cloudinary asset is gone, the row is purely metadata pointing at
 * nothing. Keeping it around just creates audit-log clutter the
 * privacy team has to explain later.
 */
@Injectable()
export class CloudinaryOrphanSweepCron {
  private readonly logger = new Logger(CloudinaryOrphanSweepCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly cloudinary: CloudinaryAdapter,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
  ) {}

  /** Daily at 04:00 UTC — low-traffic window. */
  @Cron('0 4 * * *')
  async run(): Promise<void> {
    if (
      this.env.getString('CLOUDINARY_ORPHAN_SWEEPER_ENABLED', 'true') !==
      'true'
    ) {
      return;
    }
    await this.leader.run('cloudinary-orphan-sweep', 2 * 60 * 60, async () => {
      try {
        await this.instr.wrap('cloudinary-orphan-sweep', async () => {
          const retentionDays = this.env.getNumber(
            'CLOUDINARY_ORPHAN_RETENTION_DAYS',
            30,
          );
          const batchSize = this.env.getNumber(
            'CLOUDINARY_ORPHAN_BATCH_SIZE',
            200,
          );
          const cutoff = new Date(
            Date.now() - retentionDays * 24 * 60 * 60 * 1000,
          );

          const productImages = await this.prisma.productImage.findMany({
            where: {
              publicId: { not: null },
              product: { isDeleted: true, deletedAt: { lt: cutoff } },
            },
            select: { id: true, publicId: true, productId: true },
            take: batchSize,
          });

          let deleted = 0;
          for (const row of productImages) {
            if (!row.publicId) continue;
            try {
              await this.cloudinary.delete(row.publicId);
              await this.prisma.productImage.delete({ where: { id: row.id } });
              deleted++;
            } catch (err) {
              // Best-effort: log and continue. The next tick picks it
              // up again. A persistent failure shows up in the cron
              // run's `failed` count, which feeds OpsAlertHandler via
              // the heartbeat path.
              this.logger.warn(
                `Cloudinary orphan sweep failed for ${row.publicId}: ${(err as Error).message}`,
              );
            }
          }

          // Same shape for variant images. Two loops rather than a
          // shared helper because each select projects a different
          // relation path; the duplication is small and readable.
          const variantImages = await this.prisma.productVariantImage.findMany({
            where: {
              publicId: { not: null },
              variant: {
                isDeleted: true,
                deletedAt: { lt: cutoff },
              },
            },
            select: { id: true, publicId: true, variantId: true },
            take: batchSize,
          });

          for (const row of variantImages) {
            if (!row.publicId) continue;
            try {
              await this.cloudinary.delete(row.publicId);
              await this.prisma.productVariantImage.delete({
                where: { id: row.id },
              });
              deleted++;
            } catch (err) {
              this.logger.warn(
                `Cloudinary orphan sweep failed for variant ${row.publicId}: ${(err as Error).message}`,
              );
            }
          }

          if (deleted > 0) {
            this.logger.log(
              `[cloudinary-orphan-sweep] deleted ${deleted} orphan assets (cutoff=${cutoff.toISOString()})`,
            );
          }
          return { deleted };
        });
      } catch (err) {
        this.logger.error(
          `[cloudinary-orphan-sweep] crashed: ${(err as Error).message}`,
        );
      }
    });
  }
}
