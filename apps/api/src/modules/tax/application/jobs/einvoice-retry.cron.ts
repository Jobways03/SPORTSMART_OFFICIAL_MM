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

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { EInvoiceService, EInvoiceDisabledError } from '../services/einvoice.service';
import { TaxModeService } from '../services/tax-mode.service';
import { EINVOICE_EVENTS } from '../../domain/einvoice-events';

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
    // Phase 160 (#17 / #12) — optional so unit tests can construct the cron
    // without the full DI graph.
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly taxMode?: TaxModeService,
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

  /**
   * Phase 160 (#11) — inter-call delay (ms) between IRP generate calls so a
   * 50-candidate sweep can't blow NIC's ~100/min per-credentials rate limit
   * (default 600ms ≈ 100/min). Set 0 to disable (tests / stub provider).
   */
  private interCallDelayMs(): number {
    return this.env.getNumber('TAX_EINVOICE_RETRY_INTER_CALL_MS' as any, 600);
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

    // Phase 160 (#2) — honour the kill switch. When e-invoicing is disabled
    // the sweep is a no-op (don't burn the retry cap calling a gated service).
    if (!(await this.einvoice.isEnabled())) {
      this.logger.log('IRN retry cron: e-invoicing disabled — skipping sweep.');
      return counts;
    }

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
    // Phase 160 — do NOT early-return when there are no sub-cap candidates:
    // escalation must still run, else a period whose rows are ALL exhausted
    // would never open AdminTasks (escalation was previously coupled to
    // having at least one retryable candidate in the same sweep).
    const delayMs = this.interCallDelayMs();
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!;
      try {
        await this.einvoice.generateForDocument(c.id);
        counts.generated++;
      } catch (err) {
        // Phase 160 (#2) — disabled mid-sweep: stop (don't keep hammering).
        if (err instanceof EInvoiceDisabledError) break;
        // service already wrote FAILED + retry_count via its catch
        counts.failed++;
      }
      // Phase 160 (#11) — pace inter-call so a full sweep respects NIC's
      // per-credentials rate limit. No delay after the last candidate.
      if (delayMs > 0 && i < candidates.length - 1) {
        await sleep(delayMs);
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

      // Phase 160 (#17) — publish a domain event so notification / analytics
      // subscribers can react (the AdminTask alone is invisible unless an
      // admin watches the dashboard). Fire-and-forget.
      if (this.eventBus) {
        void this.eventBus
          .publish({
            eventName: EINVOICE_EVENTS.RETRY_EXHAUSTED,
            aggregate: 'TaxDocument',
            aggregateId: e.id,
            occurredAt: new Date(),
            payload: {
              documentId: e.id,
              documentNumber: e.documentNumber,
              retryCap: cap,
              failureReason: e.einvoiceFailureReason ?? null,
            },
          })
          .catch(() => undefined);
      }

      // Phase 160 (#12) — surface the exhausted failure through the GST-mode
      // service. In STRICT mode report() throws a TaxStrictModeViolationError;
      // we catch it so one violation can't abort the whole escalation sweep —
      // the point is that the violation is recorded / logged by report().
      if (this.taxMode) {
        try {
          await this.taxMode.report({
            code: 'einvoice.generation_failed',
            message:
              `IRN generation exhausted ${cap} retries for ${e.documentNumber}`,
            context: { documentId: e.id, retryCap: cap },
          });
        } catch (err) {
          this.logger.warn(
            `tax-mode STRICT violation on e-invoice exhaustion for ${e.documentNumber}: ${(err as Error).message}`,
          );
        }
      }
    }
    return opened;
  }
}

/** Phase 160 (#11) — small awaitable sleep for inter-call pacing. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
