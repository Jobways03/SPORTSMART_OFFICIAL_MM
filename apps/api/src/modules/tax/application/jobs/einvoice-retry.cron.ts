// Phase 22 GST — IRN generation retry cron.
//
// Every 5 minutes, picks up tax_documents with einvoice_status IN
// (PENDING, FAILED) that:
//   - Have retry_count below the env cap.
//   - Have einvoice_last_attempted_at older than the cooldown.
//
// Calls EInvoiceService.generateForDocument; failures bump retry_count
// + capture failure_reason via the service's own catch path. Once a
// row hits the retry cap, opens an AdminTask
// (`EINVOICE_GENERATION_FAILED`) — idempotent on
// (kind, sourceType, sourceId).
//
// Cluster-safe via LeaderElectedCron; instrumented via
// CronInstrumentationService (counts: scanned, generated, failed,
// escalated).

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { EInvoiceService } from '../services/einvoice.service';

interface SweepCounts {
  scanned: number;
  generated: number;
  failed: number;
  escalated: number;
}

@Injectable()
export class EInvoiceRetryCron {
  private readonly logger = new Logger(EInvoiceRetryCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
    private readonly einvoice: EInvoiceService,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('TAX_EINVOICE_RETRY_CRON_ENABLED', true);
  }

  private retryCap(): number {
    return this.env.getNumber('TAX_EINVOICE_RETRY_CAP', 5);
  }

  private cooldownMinutes(): number {
    return this.env.getNumber('TAX_EINVOICE_RETRY_COOLDOWN_MINUTES', 5);
  }

  private scanLimit(): number {
    return this.env.getNumber('TAX_EINVOICE_RETRY_SCAN_LIMIT', 50);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('tax-einvoice-retry', 10 * 60, async () => {
      try {
        await this.instr.wrap('tax-einvoice-retry', () => this.runOnce());
      } catch {
        // already recorded as FAILED in cron_runs
      }
    });
  }

  async runOnce(now: Date = new Date()): Promise<SweepCounts> {
    const counts: SweepCounts = {
      scanned: 0,
      generated: 0,
      failed: 0,
      escalated: 0,
    };

    const cap = this.retryCap();
    const cooldownCutoff = new Date(
      now.getTime() - this.cooldownMinutes() * 60 * 1000,
    );
    const candidates = await this.prisma.taxDocument.findMany({
      where: {
        einvoiceStatus: { in: ['PENDING', 'FAILED'] },
        einvoiceRetryCount: { lt: cap },
        OR: [
          { einvoiceLastAttemptedAt: null },
          { einvoiceLastAttemptedAt: { lt: cooldownCutoff } },
        ],
      },
      select: { id: true, documentNumber: true },
      orderBy: { einvoiceLastAttemptedAt: 'asc' },
      take: this.scanLimit(),
    });
    counts.scanned = candidates.length;
    if (candidates.length === 0) return counts;

    for (const c of candidates) {
      try {
        await this.einvoice.generateForDocument(c.id);
        counts.generated++;
      } catch {
        // service already wrote FAILED + retry_count via its catch
        counts.failed++;
      }
    }

    counts.escalated = await this.escalateExhausted(cap);

    this.logger.log(
      `IRN retry cron: scanned=${counts.scanned} generated=${counts.generated} ` +
        `failed=${counts.failed} escalated=${counts.escalated}`,
    );
    return counts;
  }

  private async escalateExhausted(cap: number): Promise<number> {
    const exhausted = await this.prisma.taxDocument.findMany({
      where: {
        einvoiceStatus: 'FAILED',
        einvoiceRetryCount: { gte: cap },
      },
      select: {
        id: true,
        documentNumber: true,
        einvoiceFailureReason: true,
      },
      take: this.scanLimit(),
    });
    if (exhausted.length === 0) return 0;
    let opened = 0;
    for (const e of exhausted) {
      const existing = await this.prisma.adminTask.findUnique({
        where: {
          kind_sourceType_sourceId: {
            kind: 'EINVOICE_GENERATION_FAILED',
            sourceType: 'MANUAL',
            sourceId: e.id,
          },
        },
      });
      if (existing) continue;
      await this.prisma.adminTask.create({
        data: {
          kind: 'EINVOICE_GENERATION_FAILED',
          sourceType: 'MANUAL',
          sourceId: e.id,
          reason:
            `IRN generation failed ${cap}+ times for ${e.documentNumber}: ` +
            `${e.einvoiceFailureReason ?? '(no reason recorded)'}`,
        },
      });
      opened++;
    }
    return opened;
  }
}
