import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { MediaStorageAdapter } from '../../../../integrations/media/media-storage.adapter';

/**
 * Phase 14 (2026-05-16) — media storage orphan sweep.
 *
 * When a Product is soft-deleted we set `isDeleted=true, deletedAt=now()`
 * but its `ProductImage` / `ProductVariantImage` rows stay around for
 * the configured retention window. After the window expires, the
 * customer's right-to-be-forgotten under DPDP §6 requires us to drop
 * both the DB rows AND the media storage assets — otherwise an attacker
 * with a leaked media storage publicId could still pull the image months
 * after deletion.
 *
 * The sweep runs daily, leader-elected, and processes a bounded batch
 * per tick. For each image row whose parent Product was soft-deleted
 * more than `MEDIA_ORPHAN_RETENTION_DAYS` ago:
 *
 *   1. SHARED-ASSET GUARD (Cluster E #4): a publicId can be referenced
 *      by more than one row (the same media storage upload reused across a
 *      product + its variants, or across two products). If ANY other
 *      LIVE (non-soft-deleted) ProductImage / ProductVariantImage still
 *      points at this publicId, we delete only the local DB row and
 *      SKIP the media storage destroy — otherwise we would silently break
 *      a live product's image.
 *   2. Otherwise call `media.delete(publicId)`. A media storage
 *      "not found" is treated as success (the asset is already gone —
 *      the adapter swallows it), and the DB row is deleted (#7).
 *   3. The DB delete is a CAS scoped on the parent STILL being
 *      soft-deleted (#19): a row that was un-soft-deleted (product
 *      restored) between our scan and the delete is left alone.
 *   4. A row whose delete keeps failing escalates: deleteAttemptCount
 *      is incremented and, past MEDIA_ORPHAN_DELETE_RETRY_CAP, the
 *      row is marked deleteFailed=true and excluded from future sweeps
 *      so it stops retrying forever and becomes queryable for ops (#5).
 *   5. One best-effort summary audit row per tick (#6).
 *
 * KNOWN GAPS (surfaced, not built):
 *   • Upload-surface coverage (#1): this sweep only reaches images whose
 *     PARENT is soft-deleted. Other upload surfaces (KYC, branding,
 *     evidence, franchise docs) have their own lifecycles and are NOT
 *     swept here.
 *   • True-orphan reconciliation (#2): assets in media storage with NO DB
 *     row at all (e.g. an upload that crashed before the row was
 *     written) are never reclaimed — that needs a media storage→DB
 *     list-and-diff job against the Admin API, which this sweep does not
 *     do.
 */
@Injectable()
export class MediaOrphanSweepCron {
  private readonly logger = new Logger(MediaOrphanSweepCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly media: MediaStorageAdapter,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
    // Cluster E (#6) — one best-effort summary audit row per tick.
    private readonly audit: AuditPublicFacade,
  ) {}

  /** Daily at 04:00 UTC — low-traffic window. */
  @Cron('0 4 * * *')
  async run(): Promise<void> {
    if (
      this.env.getString('MEDIA_ORPHAN_SWEEPER_ENABLED', 'true') !==
      'true'
    ) {
      return;
    }
    await this.leader.run('media-orphan-sweep', 2 * 60 * 60, async () => {
      try {
        const summary = await this.instr.wrap(
          'media-orphan-sweep',
          () => this.sweepOnce(),
        );
        // Best-effort summary audit row — OUTSIDE the per-row loop and
        // unable to abort the sweep. Skip fully-idle ticks.
        if (
          summary.deleted + summary.skippedShared + summary.failed > 0
        ) {
          await this.audit
            .writeAuditLog({
              actorType: 'SYSTEM',
              action: 'catalog.media.orphan_swept',
              module: 'catalog',
              resource: 'product_image',
              metadata: {
                deleted: summary.deleted,
                skippedShared: summary.skippedShared,
                failed: summary.failed,
                escalated: summary.escalated,
                cutoff: summary.cutoff,
              },
            })
            .catch(() => undefined);
        }
      } catch (err) {
        this.logger.error(
          `[media-orphan-sweep] crashed: ${(err as Error).message}`,
        );
      }
    });
  }

  private async sweepOnce(): Promise<{
    deleted: number;
    skippedShared: number;
    failed: number;
    escalated: number;
    cutoff: string;
  }> {
    const retentionDays = this.env.getNumber(
      'MEDIA_ORPHAN_RETENTION_DAYS',
      30,
    );
    const batchSize = this.env.getNumber('MEDIA_ORPHAN_BATCH_SIZE', 200);
    const retryCap = this.env.getNumber(
      'MEDIA_ORPHAN_DELETE_RETRY_CAP',
      5,
    );
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const counts = { deleted: 0, skippedShared: 0, failed: 0, escalated: 0 };

    // ── ProductImage ────────────────────────────────────────────────
    const productImages = await this.prisma.productImage.findMany({
      where: {
        publicId: { not: null },
        // Exclude rows already escalated as permanently-failing so they
        // don't churn the sweep every day forever (#5).
        deleteFailed: false,
        product: { isDeleted: true, deletedAt: { lt: cutoff } },
      },
      select: { id: true, publicId: true },
      take: batchSize,
    });

    for (const row of productImages) {
      if (!row.publicId) continue;
      await this.processRow('productImage', row.id, row.publicId, retryCap, counts);
    }

    // ── ProductVariantImage ─────────────────────────────────────────
    const variantImages = await this.prisma.productVariantImage.findMany({
      where: {
        publicId: { not: null },
        deleteFailed: false,
        variant: { isDeleted: true, deletedAt: { lt: cutoff } },
      },
      select: { id: true, publicId: true },
      take: batchSize,
    });

    for (const row of variantImages) {
      if (!row.publicId) continue;
      await this.processRow(
        'productVariantImage',
        row.id,
        row.publicId,
        retryCap,
        counts,
      );
    }

    if (counts.deleted + counts.skippedShared + counts.failed > 0) {
      this.logger.log(
        `[media-orphan-sweep] deleted=${counts.deleted} ` +
          `skippedShared=${counts.skippedShared} failed=${counts.failed} ` +
          `escalated=${counts.escalated} (cutoff=${cutoff.toISOString()})`,
      );
    }
    return { ...counts, cutoff: cutoff.toISOString() };
  }

  /**
   * Process one image row: shared-asset guard → media storage destroy →
   * CAS DB delete. Per-row failures are isolated (the row's
   * deleteAttemptCount is bumped + escalated past the cap) so one bad
   * row never aborts the batch.
   */
  private async processRow(
    table: 'productImage' | 'productVariantImage',
    id: string,
    publicId: string,
    retryCap: number,
    counts: { deleted: number; skippedShared: number; failed: number; escalated: number },
  ): Promise<void> {
    try {
      const shared = await this.isPublicIdSharedByLiveRow(publicId, table, id);

      if (!shared) {
        // No live row references this asset — safe to drop it from
        // media storage. The adapter treats "not found" as success (it
        // swallows + logs), so an already-gone asset still falls
        // through to the DB delete below (#7).
        await this.media.delete(publicId);
      } else {
        // Another LIVE product/variant still uses this exact asset.
        // Delete only our metadata row; leave media storage intact (#4).
        counts.skippedShared++;
      }

      // CAS DB delete: scope on the parent STILL being soft-deleted so
      // a restore (un-soft-delete) between scan and now wins the race
      // and the row is preserved (#19). deleteMany returns count=0 on a
      // lost race; we treat that as a benign skip.
      const del = await this.deleteRowIfParentStillDeleted(table, id);
      if (del.count > 0) {
        counts.deleted++;
      } else {
        this.logger.warn(
          `[media-orphan-sweep] ${table} ${id} not deleted: parent no ` +
            `longer soft-deleted (restored under us) — left intact.`,
        );
      }
    } catch (err) {
      counts.failed++;
      const escalated = await this.recordDeleteFailure(
        table,
        id,
        (err as Error).message,
        retryCap,
      );
      if (escalated) counts.escalated++;
      this.logger.warn(
        `[media-orphan-sweep] ${table} ${id} (publicId=${publicId}) ` +
          `failed: ${(err as Error).message}` +
          (escalated ? ' — escalated to deleteFailed after retry cap.' : ''),
      );
    }
  }

  /**
   * True if `publicId` is referenced by at least one LIVE (parent NOT
   * soft-deleted) row in either image table, OTHER than (table, id).
   * Such an asset must NOT be deleted from media storage — a live product
   * still serves it.
   */
  private async isPublicIdSharedByLiveRow(
    publicId: string,
    selfTable: 'productImage' | 'productVariantImage',
    selfId: string,
  ): Promise<boolean> {
    const liveProductImage = await this.prisma.productImage.count({
      where: {
        publicId,
        product: { isDeleted: false },
        ...(selfTable === 'productImage' ? { id: { not: selfId } } : {}),
      },
    });
    if (liveProductImage > 0) return true;

    const liveVariantImage = await this.prisma.productVariantImage.count({
      where: {
        publicId,
        variant: { isDeleted: false },
        ...(selfTable === 'productVariantImage' ? { id: { not: selfId } } : {}),
      },
    });
    return liveVariantImage > 0;
  }

  private deleteRowIfParentStillDeleted(
    table: 'productImage' | 'productVariantImage',
    id: string,
  ): Promise<{ count: number }> {
    if (table === 'productImage') {
      return this.prisma.productImage.deleteMany({
        where: { id, product: { isDeleted: true } },
      });
    }
    return this.prisma.productVariantImage.deleteMany({
      where: { id, variant: { isDeleted: true } },
    });
  }

  /**
   * Bump the row's deleteAttemptCount + record the error. Once the
   * attempt count reaches the cap, mark deleteFailed=true so the row is
   * excluded from future sweeps (escalation, #5). Returns true if this
   * call crossed the cap.
   */
  private async recordDeleteFailure(
    table: 'productImage' | 'productVariantImage',
    id: string,
    message: string,
    retryCap: number,
  ): Promise<boolean> {
    const lastDeleteError = message.slice(0, 500);
    try {
      if (table === 'productImage') {
        const updated = await this.prisma.productImage.update({
          where: { id },
          data: {
            deleteAttemptCount: { increment: 1 },
            lastDeleteError,
          },
          select: { deleteAttemptCount: true },
        });
        if (updated.deleteAttemptCount >= retryCap) {
          await this.prisma.productImage.update({
            where: { id },
            data: { deleteFailed: true },
          });
          return true;
        }
        return false;
      }
      const updated = await this.prisma.productVariantImage.update({
        where: { id },
        data: {
          deleteAttemptCount: { increment: 1 },
          lastDeleteError,
        },
        select: { deleteAttemptCount: true },
      });
      if (updated.deleteAttemptCount >= retryCap) {
        await this.prisma.productVariantImage.update({
          where: { id },
          data: { deleteFailed: true },
        });
        return true;
      }
      return false;
    } catch (err) {
      // The row may have been deleted by a concurrent process; the
      // failure-tracking write is itself best-effort.
      this.logger.warn(
        `[media-orphan-sweep] could not record delete failure for ` +
          `${table} ${id}: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
