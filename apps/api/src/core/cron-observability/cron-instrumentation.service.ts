import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import {
  CounterHandle,
  HistogramHandle,
  MetricsRegistry,
} from '../metrics/metrics.registry';

/**
 * Phase 8 (PR 8.3) — Cron run instrumentation.
 *
 * Wraps any async function with start / end / failure rows in
 * `cron_runs`. The standard cron pattern becomes:
 *
 *   @Cron(CronExpression.EVERY_10_MINUTES)
 *   async run() {
 *     await this.instr.wrap('idempotency.sweeper', () => this.sweep());
 *   }
 *
 * The wrap helper:
 *   - inserts a RUNNING row before invoking,
 *   - on success: updates to SUCCEEDED + durationMs + (optionally) result,
 *   - on throw: updates to FAILED + error,
 *   - rethrows the original error so cron retry semantics are unchanged.
 *
 * The function's return value is captured in the `result` JSON column
 * when it's a plain object — handlers like:
 *
 *   await instr.wrap('return.refund-processor', async () => {
 *     const out = await this.processBatch();
 *     return { processed: out.processed, failed: out.failed };
 *   });
 *
 * give us a SQL-queryable per-cron metric without log scraping.
 *
 * Phase 5 (PR 5.6) — every wrap also emits two Prometheus metrics so
 * the cron observability surface is visible to Grafana / scrapers
 * without requiring SQL access:
 *
 *   `cron_runs_total{jobName, status}` — counter, monotonically
 *     incremented per finish. status ∈ {SUCCEEDED, FAILED}.
 *
 *   `cron_run_duration_ms{jobName}` — histogram observation per
 *     finish (both success and failure paths). Bucket boundaries
 *     come from the registry default (10ms…30s); for slow daily
 *     crons (reconciliation) the +Inf bucket carries everything
 *     past 30s, which is fine for dashboards.
 */
@Injectable()
export class CronInstrumentationService {
  private readonly logger = new Logger(CronInstrumentationService.name);

  /** Hard cap on error string length so a runaway trace doesn't OOM the row. */
  private static readonly ERROR_MAX_BYTES = 4 * 1024;

  private readonly runsCounter: CounterHandle;
  private readonly durationHistogram: HistogramHandle;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsRegistry,
  ) {
    // Register at construct time so the /metrics endpoint shows the
    // HELP / TYPE lines even before any cron has fired (a Grafana
    // panel pinned to these names needs the descriptor lines to
    // resolve consistently across deploys).
    this.runsCounter = this.metrics.counter(
      'cron_runs_total',
      'Cron runs completed, per job and terminal status.',
    );
    this.durationHistogram = this.metrics.histogram(
      'cron_run_duration_ms',
      'Cron run wall-clock duration in milliseconds, per job.',
    );
  }

  async wrap<T>(jobName: string, fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    let runId: string | null = null;
    try {
      const row = await this.prisma.cronRun.create({
        data: { jobName, status: 'RUNNING' },
        select: { id: true },
      });
      runId = row.id;
    } catch (err) {
      // If the registry is unhealthy we still want the cron to run.
      // Log and proceed — losing the audit row is preferable to
      // wedging the actual job.
      this.logger.warn(
        `cron-run registry insert failed for ${jobName}: ${(err as Error).message}`,
      );
    }

    try {
      const result = await fn();
      await this.markFinished(runId, jobName, started, 'SUCCEEDED', result);
      return result;
    } catch (err) {
      await this.markFinished(
        runId,
        jobName,
        started,
        'FAILED',
        undefined,
        err as Error,
      );
      throw err;
    }
  }

  private async markFinished(
    runId: string | null,
    jobName: string,
    started: number,
    status: 'SUCCEEDED' | 'FAILED',
    result?: unknown,
    err?: Error,
  ): Promise<void> {
    const durationMs = Date.now() - started;

    // Phase 5 (PR 5.6) — Prometheus metrics. Emit regardless of
    // whether the cron_runs row was successfully created: a failure
    // to insert the audit row (e.g. DB blip) shouldn't mean the
    // duration / status is also missing from /metrics, which is the
    // dashboard that pages on-call.
    this.runsCounter.inc({ jobName, status });
    this.durationHistogram.observe(durationMs, { jobName });

    if (!runId) return;
    const errorText = err
      ? truncate(err.stack ?? err.message, CronInstrumentationService.ERROR_MAX_BYTES)
      : null;
    const resultJson =
      result !== undefined && isPlainObject(result)
        ? (result as Prisma.InputJsonValue)
        : undefined;
    try {
      await this.prisma.cronRun.update({
        where: { id: runId },
        data: {
          status,
          finishedAt: new Date(),
          durationMs,
          error: errorText,
          ...(resultJson !== undefined ? { result: resultJson } : {}),
        },
      });
    } catch (e) {
      this.logger.warn(
        `cron-run registry update failed for ${jobName}: ${(e as Error).message}`,
      );
    }
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    v.constructor === Object
  );
}
