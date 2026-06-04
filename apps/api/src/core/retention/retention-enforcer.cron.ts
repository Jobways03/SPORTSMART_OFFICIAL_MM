import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, type RetentionAction } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { EnvService } from '../../bootstrap/env/env.service';
import { LegalHoldService } from './legal-hold.service';
import { LeaderElectedCron } from '../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../cron-observability/cron-instrumentation.service';
import { R2Adapter } from '../../integrations/r2/adapters/r2.adapter';

/**
 * Phase 7 (PR 7.2) — Daily retention enforcer.
 *
 * Walks each enabled RetentionPolicy, finds files older than
 * `retainDays` matching its (resourceType, purpose), and applies the
 * configured action — but only after the legal-hold checker clears
 * the file.
 *
 * Volumes / safety:
 *   - Hard cap of 1000 files per policy per run. A backlog larger
 *     than that catches up over multiple runs; we'd rather under-act
 *     than under-monitor.
 *   - DRY-RUN mode (RETENTION_ENFORCER_DRY_RUN=true): logs every
 *     would-act file but doesn't mutate. Use during the soak window.
 *   - Held files write a RetentionExecution row with legalHold=true
 *     so the runbook query can show "what we tried but skipped".
 */
@Injectable()
export class RetentionEnforcerCron {
  private readonly logger = new Logger(RetentionEnforcerCron.name);
  private static readonly PER_POLICY_LIMIT = 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly legalHold: LegalHoldService,
    // Phase 1 (PR 1.2) — daily retention enforcement runs across the
    // ENTIRE file table. We do NOT want N replicas each running
    // delete-many in parallel.
    private readonly leader: LeaderElectedCron,
    // Phase 5 (PR 5.3) — cron-run observability. Records the
    // `{ acted, held, skipped, dryRun }` shape so ops can chart
    // retention-policy effect over time + spot a stuck enforcer.
    private readonly instr: CronInstrumentationService,
    // Phase 253 (#9) — real storage erasure. DELETE/ARCHIVE/REDACT used to
    // only mutate the DB row, leaving the bytes publicly served — a DPDP §6
    // right-to-erasure breach for KYC/evidence. R2 erasure for objects
    // stored in Cloudflare R2 (the only object-storage path now).
    private readonly r2: R2Adapter,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('RETENTION_ENFORCER_ENABLED', false);
  }

  isDryRun(): boolean {
    return this.env.getBoolean('RETENTION_ENFORCER_DRY_RUN', true);
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    if (!this.enabled()) return;

    // Daily run — TTL = 12h (worst-case row count × per-policy work).
    await this.leader.run('retention-enforcer', 12 * 60 * 60, async () => {
      try {
        await this.instr.wrap('retention-enforcer', () => this.runOnce());
      } catch {
        // already recorded as FAILED in cron_runs
      }
    });
  }

  private async runOnce(): Promise<{
    acted: number;
    held: number;
    skipped: number;
    dryRun: boolean;
  }> {
    const dryRun = this.isDryRun();
    let policies: Array<any> = [];
    try {
      policies = await this.prisma.retentionPolicy.findMany({
        where: { enabled: true },
      });
    } catch (err) {
      this.logger.error(`Failed to load policies: ${(err as Error).message}`);
      return { acted: 0, held: 0, skipped: 0, dryRun };
    }

    let totals = { acted: 0, held: 0, skipped: 0 };
    for (const p of policies) {
      try {
        const counts = await this.runPolicy(p, dryRun);
        totals = sum(totals, counts);
      } catch (err) {
        this.logger.warn(
          `Retention policy ${p.id} (${p.resourceType}/${p.purpose}) failed: ${(err as Error).message}`,
        );
      }
    }

    if (totals.acted > 0 || totals.held > 0 || totals.skipped > 0) {
      this.logger.log(
        `retention enforcer ${dryRun ? '[DRY-RUN] ' : ''}acted=${totals.acted} held=${totals.held} skipped=${totals.skipped}`,
      );
    }
    return { ...totals, dryRun };
  }

  private async runPolicy(
    policy: any,
    dryRun: boolean,
  ): Promise<{ acted: number; held: number; skipped: number }> {
    if (policy.resourceType !== 'file') {
      // Today only `file` is wired. Other resource types are reserved
      // for future expansion (dispute messages, audit logs).
      return { acted: 0, held: 0, skipped: 0 };
    }

    const cutoff = new Date(
      Date.now() - policy.retainDays * 24 * 60 * 60 * 1000,
    );

    const where: Prisma.FileMetadataWhereInput = {
      createdAt: { lt: cutoff },
      deletedAt: null,
      status: { not: 'DELETED' },
    };
    if (policy.purpose !== '*') {
      // FilePurpose enum value
      (where as any).purpose = policy.purpose;
    }

    const candidates = await this.prisma.fileMetadata.findMany({
      where,
      select: { id: true },
      take: RetentionEnforcerCron.PER_POLICY_LIMIT,
      orderBy: { createdAt: 'asc' },
    });

    let acted = 0;
    let held = 0;
    for (const c of candidates) {
      const hold = await this.legalHold.check(c.id);
      if (hold.held) {
        held++;
        await this.prisma.retentionExecution.create({
          data: {
            policyId: policy.id,
            resourceType: policy.resourceType,
            resourceId: c.id,
            action: policy.action as RetentionAction,
            legalHold: true,
            legalHoldReason: hold.reason,
          },
        });
        continue;
      }
      if (dryRun) {
        await this.prisma.retentionExecution.create({
          data: {
            policyId: policy.id,
            resourceType: policy.resourceType,
            resourceId: c.id,
            action: policy.action as RetentionAction,
            legalHold: false,
            legalHoldReason: '[DRY-RUN] would have acted',
          },
        });
        acted++;
        continue;
      }
      await this.applyAction(policy.action as RetentionAction, c.id);
      await this.prisma.retentionExecution.create({
        data: {
          policyId: policy.id,
          resourceType: policy.resourceType,
          resourceId: c.id,
          action: policy.action as RetentionAction,
          legalHold: false,
        },
      });
      acted++;
    }
    return { acted, held, skipped: 0 };
  }

  private async applyAction(
    action: RetentionAction,
    fileId: string,
  ): Promise<void> {
    // Phase 253 (#9) — destroy the storage bytes for EVERY action. Without
    // this, "deleted"/"redacted" KYC/evidence stayed resolvable at its
    // public media URL (the URL is reconstructable from providerFileId, which
    // REDACT did not touch). Best-effort: a failed provider delete is logged
    // but we still apply the DB mutation; the orphan sweep / next run retries.
    await this.destroyStorage(action, fileId);
    switch (action) {
      case 'DELETE':
      case 'ARCHIVE':
        // status 'ARCHIVED' isn't in the enum yet; soft-delete +
        // RetentionExecution.action distinguishes them.
        await this.prisma.fileMetadata.update({
          where: { id: fileId },
          data: { status: 'DELETED', deletedAt: new Date() },
        });
        return;
      case 'REDACT':
        // Strip PII — keep the row + hash + ID for audit, but the bytes are
        // now destroyed above and the URL fields are blanked.
        await this.prisma.fileMetadata.update({
          where: { id: fileId },
          data: { fileName: '[REDACTED]', providerUrl: null, deletedAt: new Date() },
        });
        return;
    }
  }

  private async destroyStorage(action: RetentionAction, fileId: string): Promise<void> {
    const file = await this.prisma.fileMetadata.findUnique({
      where: { id: fileId },
      select: { provider: true, providerFileId: true, storageKey: true, mimeType: true },
    });
    if (!file) return;
    const key = file.providerFileId ?? file.storageKey;
    if (!key) return;
    if (file.provider === 'cloudinary') {
      // Legacy Cloudinary asset. The Cloudinary backend has been removed
      // (platform is now R2-only), so the bytes can't be erased remotely
      // from here — log it for manual cleanup; the DB-side retention
      // mutation still applies. No real Cloudinary data exists post-
      // migration; this guard only covers any stray legacy rows.
      this.logger.warn(
        `Retention ${action}: file ${fileId} is a legacy Cloudinary asset — ` +
          `Cloudinary backend removed, cannot erase remotely; DB mutation still applied`,
      );
    } else if (file.provider === 'r2') {
      try {
        await this.r2.deleteFile(file.storageKey);
      } catch (e) {
        this.logger.warn(
          `Retention ${action}: R2 delete failed for file ${fileId} (${(e as Error).message}) — DB mutation still applied; will retry next run`,
        );
      }
    }
  }
}

function sum(
  a: { acted: number; held: number; skipped: number },
  b: { acted: number; held: number; skipped: number },
) {
  return {
    acted: a.acted + b.acted,
    held: a.held + b.held,
    skipped: a.skipped + b.skipped,
  };
}
