// Phase 19 GST — PDF render retry cron.
//
// Every 5 minutes, picks up tax_documents with status IN
// (PDF_PENDING, PDF_FAILED) that:
//   - Have retryCount below the env cap.
//   - Have last_attempted_at older than the cooldown (or null).
//
// For each, calls TaxDocumentPdfService.renderAndUpload. Per-doc
// failures call markAttemptFailed. Once a row hits the retry cap
// without success, an AdminTask (TAX_DOCUMENT_PDF_FAILED) opens
// once (idempotent on (kind, sourceType, sourceId)).
//
// Cluster-safe via LeaderElectedCron; instrumented via
// CronInstrumentationService (recorded counts: scanned, rendered,
// failed, escalated).

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { TaxDocumentPdfService } from '../services/tax-document-pdf.service';

interface SweepCounts {
  scanned: number;
  rendered: number;
  failed: number;
  escalated: number;
}

@Injectable()
export class TaxDocumentPdfRetryCron {
  private readonly logger = new Logger(TaxDocumentPdfRetryCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
    private readonly pdfService: TaxDocumentPdfService,
    // Cluster E — one best-effort summary audit row per tick so the
    // render/failed/escalated counts are queryable in the forensic
    // trail (instrumentation captures duration; this captures outcome).
    private readonly audit: AuditPublicFacade,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('TAX_PDF_RETRY_CRON_ENABLED', true);
  }

  private retryCap(): number {
    return this.env.getNumber('TAX_PDF_RETRY_CAP', 5);
  }

  private cooldownMinutes(): number {
    return this.env.getNumber('TAX_PDF_RETRY_COOLDOWN_MINUTES', 5);
  }

  private scanLimit(): number {
    return this.env.getNumber('TAX_PDF_RETRY_SCAN_LIMIT', 50);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('tax-document-pdf-retry', 10 * 60, async () => {
      try {
        const counts = await this.instr.wrap('tax-document-pdf-retry', () =>
          this.runOnce(),
        );
        // Best-effort summary audit row — OUTSIDE any per-doc work and
        // unable to abort the sweep. Skip idle ticks (nothing to render)
        // so the audit log isn't flooded every 5 minutes.
        if (counts.rendered + counts.failed + counts.escalated > 0) {
          await this.audit
            .writeAuditLog({
              actorType: 'SYSTEM',
              action: 'tax.document.pdf_retry_swept',
              module: 'tax',
              resource: 'tax_document',
              metadata: {
                scanned: counts.scanned,
                rendered: counts.rendered,
                failed: counts.failed,
                escalated: counts.escalated,
              },
            })
            .catch(() => undefined);
        }
      } catch {
        // already recorded as FAILED in cron_runs
      }
    });
  }

  async runOnce(now: Date = new Date()): Promise<SweepCounts> {
    const counts: SweepCounts = {
      scanned: 0,
      rendered: 0,
      failed: 0,
      escalated: 0,
    };

    const cap = this.retryCap();
    const cooldownMs = this.cooldownMinutes() * 60 * 1000;
    const cooldownCutoff = new Date(now.getTime() - cooldownMs);
    const limit = this.scanLimit();

    const candidates = await this.prisma.taxDocument.findMany({
      where: {
        status: { in: ['PDF_PENDING', 'PDF_FAILED'] },
        pdfRetryCount: { lt: cap },
        OR: [
          { pdfLastAttemptedAt: null },
          { pdfLastAttemptedAt: { lt: cooldownCutoff } },
        ],
      },
      select: { id: true, documentNumber: true },
      orderBy: { pdfLastAttemptedAt: 'asc' },
      take: limit,
    });
    counts.scanned = candidates.length;
    if (candidates.length === 0) return counts;

    for (const c of candidates) {
      try {
        await this.pdfService.renderAndUpload({ documentId: c.id });
        counts.rendered++;
      } catch (err) {
        const reason = (err as Error).message ?? String(err);
        await this.pdfService.markAttemptFailed({
          documentId: c.id,
          reason,
        });
        counts.failed++;
      }
    }

    // After this pass, check for any rows that have hit the cap and
    // open an escalation AdminTask. Idempotent on (kind, sourceType,
    // sourceId).
    counts.escalated = await this.escalateExhausted(cap);

    this.logger.log(
      `PDF retry cron: scanned=${counts.scanned} rendered=${counts.rendered} ` +
        `failed=${counts.failed} escalated=${counts.escalated}`,
    );
    return counts;
  }

  private async escalateExhausted(cap: number): Promise<number> {
    const exhausted = await this.prisma.taxDocument.findMany({
      where: {
        status: 'PDF_FAILED',
        pdfRetryCount: { gte: cap },
      },
      select: { id: true, documentNumber: true, pdfFailureReason: true },
      take: this.scanLimit(),
    });
    if (exhausted.length === 0) return 0;

    let opened = 0;
    for (const e of exhausted) {
      const existing = await this.prisma.adminTask.findUnique({
        where: {
          kind_sourceType_sourceId: {
            kind: 'TAX_DOCUMENT_PDF_FAILED',
            sourceType: 'MANUAL', // tax_documents aren't in LedgerSourceType
            sourceId: e.id,
          },
        },
      });
      if (existing) continue;
      await this.prisma.adminTask.create({
        data: {
          kind: 'TAX_DOCUMENT_PDF_FAILED',
          sourceType: 'MANUAL',
          sourceId: e.id,
          reason:
            `PDF render failed ${cap}+ times for ${e.documentNumber}: ` +
            `${e.pdfFailureReason ?? '(no reason recorded)'}`,
        },
      });
      opened++;
    }
    return opened;
  }
}
