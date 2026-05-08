import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';

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
 */
@Injectable()
export class CronInstrumentationService {
  private readonly logger = new Logger(CronInstrumentationService.name);

  /** Hard cap on error string length so a runaway trace doesn't OOM the row. */
  private static readonly ERROR_MAX_BYTES = 4 * 1024;

  constructor(private readonly prisma: PrismaService) {}

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
    if (!runId) return;
    const durationMs = Date.now() - started;
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
