import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { MediaStorageAdapter } from '../../../../integrations/media/media-storage.adapter';

/**
 * Phase 199 (2026-06-02) — Returns audit #9: orphaned evidence cleanup.
 *
 * The customer return wizard uploads issue photos to media
 * (`POST /customer/returns/evidence`, folder
 * `sportsmart/returns/evidence/<userId>/`) BEFORE the return is
 * submitted. If the customer abandons the wizard after uploading, those
 * assets are never referenced by any `return_evidence` row — they are
 * true orphans with no DB record at all. Storage accrues silently.
 *
 * ── HONEST-CALL / bounded skeleton ───────────────────────────────────
 * Finding the orphans requires *listing* media assets by folder
 * prefix and diffing against the `return_evidence.public_id` set. The
 * platform's MediaStorageAdapter currently exposes only `upload` +
 * `delete(publicId)` — it has NO Admin-API `resources(prefix)` listing
 * capability, and that listing requires signed admin credentials we do
 * not exercise offline. Building (and credentialing) the media
 * Admin API is a real external-integration change.
 *
 * So this cron is a FAIL-CLOSED skeleton:
 *   - LeaderElected + instrumented + scheduled daily, exactly like the
 *     other returns crons, so wiring + observability are in place.
 *   - Default OFF (RETURN_EVIDENCE_ORPHAN_CLEANUP_ENABLED, default
 *     'false'). It no-ops until ops both (a) add the media
 *     resources(prefix) listing to MediaStorageAdapter and (b) flip the
 *     flag.
 *   - When the listing capability lands, the loop below already has the
 *     DB side written (the referenced-publicId set + the >24h cutoff);
 *     only the `listmediaEvidenceAssets` call needs implementing.
 *   - It NEVER deletes unless it can positively confirm an asset is
 *     both older than the cutoff AND absent from `return_evidence`.
 *
 * The matching DB-side cleanup (evidence rows whose parent return is
 * long-terminal) is intentionally NOT swept here: those rows are still
 * legitimately referenced by the return record (forfeit-policy audit
 * trail) and must be retained.
 */
@Injectable()
export class OrphanedEvidenceCleanupCron {
  private readonly logger = new Logger(OrphanedEvidenceCleanupCron.name);
  // Assets younger than this are skipped — a wizard mid-flight may not
  // have submitted yet, so a fresh upload is NOT an orphan.
  private static readonly MIN_AGE_HOURS = 24;
  private static readonly EVIDENCE_FOLDER_PREFIX = 'sportsmart/returns/evidence/';

  constructor(
    private readonly env: EnvService,
    private readonly instrumentation: CronInstrumentationService,
    private readonly leader: LeaderElectedCron,
    private readonly prisma: PrismaService,
    private readonly media: MediaStorageAdapter,
  ) {}

  enabled(): boolean {
    // Default OFF — see class doc. Flip only once media listing is
    // implemented + credentialed.
    return this.env.getBoolean(
      'RETURN_EVIDENCE_ORPHAN_CLEANUP_ENABLED' as any,
      false,
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run(
      'returns-orphaned-evidence-cleanup',
      30 * 60,
      async () => {
        await this.instrumentation.wrap(
          'returns.orphaned_evidence_cleanup',
          async () => this.sweep(),
        );
      },
    );
  }

  /**
   * Returns the media publicIds under the evidence folder older
   * than the cutoff. BOUNDED SKELETON: returns [] until the Admin-API
   * listing is added to MediaStorageAdapter. Kept as a seam so the rest of
   * the diff logic is testable + ready.
   */
  private async listmediaEvidenceAssets(
    _olderThan: Date,
  ): Promise<Array<{ publicId: string; createdAt: Date }>> {
    // INTENTIONAL no-op: MediaStorageAdapter has no list(prefix) seam
    // yet. Implement against R2's ListObjectsV2 (prefix=EVIDENCE_FOLDER_
    // PREFIX, paginated via ContinuationToken), then return the mapped rows.
    void OrphanedEvidenceCleanupCron.EVIDENCE_FOLDER_PREFIX;
    return [];
  }

  private async sweep(): Promise<{ scanned: number; deleted: number }> {
    const cutoff = new Date(
      Date.now() - OrphanedEvidenceCleanupCron.MIN_AGE_HOURS * 60 * 60 * 1000,
    );
    const candidates = await this.listmediaEvidenceAssets(cutoff);
    if (candidates.length === 0) {
      // Skeleton path (listing not implemented) — nothing to do.
      return { scanned: 0, deleted: 0 };
    }

    // Diff against referenced publicIds. Only delete assets that are
    // BOTH older than the cutoff AND not referenced by any evidence row.
    const publicIds = candidates.map((c) => c.publicId);
    const referenced = await this.prisma.returnEvidence.findMany({
      where: { publicId: { in: publicIds } },
      select: { publicId: true },
    });
    const referencedSet = new Set(
      referenced.map((r) => r.publicId).filter(Boolean) as string[],
    );

    let deleted = 0;
    for (const asset of candidates) {
      if (asset.createdAt > cutoff) continue; // too fresh
      if (referencedSet.has(asset.publicId)) continue; // still referenced
      try {
        await this.media.delete(asset.publicId);
        deleted += 1;
      } catch (err) {
        this.logger.warn(
          `orphan-evidence cleanup: failed to delete ${asset.publicId}: ${
            (err as Error)?.message ?? 'unknown'
          }`,
        );
      }
    }
    if (deleted > 0) {
      this.logger.log(
        `Orphaned evidence cleanup removed ${deleted}/${candidates.length} asset(s)`,
      );
    }
    return { scanned: candidates.length, deleted };
  }
}
