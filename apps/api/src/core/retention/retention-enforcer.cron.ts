import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, type RetentionAction } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { EnvService } from '../../bootstrap/env/env.service';
import { LegalHoldService } from './legal-hold.service';

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

    const dryRun = this.isDryRun();
    let policies: Array<any> = [];
    try {
      policies = await this.prisma.retentionPolicy.findMany({
        where: { enabled: true },
      });
    } catch (err) {
      this.logger.error(`Failed to load policies: ${(err as Error).message}`);
      return;
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
    switch (action) {
      case 'DELETE':
        await this.prisma.fileMetadata.update({
          where: { id: fileId },
          data: { status: 'DELETED', deletedAt: new Date() },
        });
        return;
      case 'ARCHIVE':
        // Storage-tier flip (S3 lifecycle / Cloudinary archived flag) is
        // provider-specific; we mark the metadata so reads route through
        // a different code path. The actual provider call lands in the
        // S3 lifecycle PR (out of scope here).
        await this.prisma.fileMetadata.update({
          where: { id: fileId },
          data: { status: 'DELETED', deletedAt: new Date() },
          // status 'ARCHIVED' isn't in the enum yet; soft-delete +
          // RetentionExecution.action='ARCHIVE' is the temporary
          // compromise. Tracked in the ADR.
        });
        return;
      case 'REDACT':
        // Strip PII — keep the row + hash + ID for audit, but blank
        // file_name and provider URLs.
        await this.prisma.fileMetadata.update({
          where: { id: fileId },
          data: {
            fileName: '[REDACTED]',
            providerUrl: null,
          },
        });
        return;
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
