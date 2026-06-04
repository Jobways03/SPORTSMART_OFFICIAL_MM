import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { EnvService } from '../../bootstrap/env/env.service';
import { EventBusService } from '../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../cron-observability/cron-instrumentation.service';
import { hashesEqual } from './file-hash.util';

/**
 * Phase 7 (PR 7.5) — Periodic file-integrity verifier.
 *
 * Two responsibilities, one cadence:
 *   1. **Backfill**: READY files with `hashedAt = NULL` predate the
 *      hashing infrastructure. We can't compute their hash from
 *      memory — we'd have to fetch from object storage. The verifier
 *      pulls them in batches and either:
 *        - emits `file.integrity.backfill_pending` so a provider-aware
 *          job (out-of-scope here, lands as a follow-up) can fetch +
 *          hash, OR
 *        - if FileFetcher is wired, fetches inline and writes the hash.
 *      v1 ships the event-emit path; the inline fetcher arrives once
 *      the media/r2 adapters expose a `download(key)` method.
 *   2. **Re-verify**: READY files whose `lastVerifiedAt` is older than
 *      `INTEGRITY_VERIFIER_REVERIFY_DAYS` are re-fetched and the
 *      computed hash is compared with the stored one. Mismatch ⇒
 *      `file.integrity.violation` event ⇒ alerts.
 *
 * Cadence default: hourly. Batch size default: 100. Both env-tunable.
 */
@Injectable()
export class IntegrityVerifierCron {
  private readonly logger = new Logger(IntegrityVerifierCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
    // Phase 1 (PR 1.2) — multi-replica safety. Hashing+fetching every
    // file row on every replica would be a per-byte multiplier.
    private readonly leader: LeaderElectedCron,
    // Phase 5 (PR 5.3) — cron-run observability. Captures
    // `{ candidates, backfilled, reverified, violations }` per tick.
    private readonly instr: CronInstrumentationService,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('INTEGRITY_VERIFIER_ENABLED', false);
  }

  batchSize(): number {
    return this.env.getNumber('INTEGRITY_VERIFIER_BATCH_SIZE', 100);
  }

  reverifyDays(): number {
    return this.env.getNumber('INTEGRITY_VERIFIER_REVERIFY_DAYS', 30);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (!this.enabled()) return;

    await this.leader.run('integrity-verifier', 2 * 60 * 60, async () => {
      try {
        await this.instr.wrap('integrity-verifier', () => this.runOnce());
      } catch {
        // already recorded as FAILED in cron_runs
      }
    });
  }

  /** Body extracted so the leader-wrapper stays a one-liner. */
  private async runOnce(): Promise<{
    candidates: number;
    backfilled: number;
    reverified: number;
    violations: number;
  }> {
    const reverifyCutoff = new Date(
      Date.now() - this.reverifyDays() * 24 * 60 * 60 * 1000,
    );

    // Pull files needing attention. Two ORs collapsed into one
    // findMany — Postgres handles the partition cheaply on the
    // (status, last_verified_at) index added in PR 7.1.
    let candidates: Array<{
      id: string;
      contentSha256: string | null;
      hashedAt: Date | null;
      lastVerifiedAt: Date | null;
      provider: string;
      storageKey: string;
    }> = [];
    try {
      candidates = await this.prisma.fileMetadata.findMany({
        where: {
          status: 'READY',
          deletedAt: null,
          OR: [
            { hashedAt: null },
            { lastVerifiedAt: null },
            { lastVerifiedAt: { lt: reverifyCutoff } },
          ],
        },
        select: {
          id: true,
          contentSha256: true,
          hashedAt: true,
          lastVerifiedAt: true,
          provider: true,
          storageKey: true,
        },
        take: this.batchSize(),
        orderBy: [{ lastVerifiedAt: 'asc' }, { createdAt: 'asc' }],
      });
    } catch (err) {
      this.logger.error(
        `Integrity verifier load failed: ${(err as Error).message}`,
      );
      return { candidates: 0, backfilled: 0, reverified: 0, violations: 0 };
    }

    let backfilled = 0;
    let reverified = 0;
    let violations = 0;
    for (const c of candidates) {
      try {
        const computed = await this.fetchAndHash(c.provider, c.storageKey);
        if (computed === null) {
          // Provider download not wired yet — emit an event for a
          // provider-aware follow-up job.
          await this.emitBackfillPending(c.id, c.provider);
          continue;
        }
        if (!c.contentSha256) {
          // Backfill case.
          await this.prisma.fileMetadata.update({
            where: { id: c.id },
            data: {
              contentSha256: computed,
              hashedAt: new Date(),
              lastVerifiedAt: new Date(),
            },
          });
          backfilled += 1;
          continue;
        }
        if (!hashesEqual(computed, c.contentSha256)) {
          violations += 1;
          await this.emitViolation(c.id, c.contentSha256, computed);
          // Do NOT update lastVerifiedAt: leaving it stale ensures the
          // next pass picks the same file again so the alert keeps
          // firing until ops resolves.
          continue;
        }
        await this.prisma.fileMetadata.update({
          where: { id: c.id },
          data: { lastVerifiedAt: new Date() },
        });
        reverified += 1;
      } catch (err) {
        this.logger.warn(
          `Integrity check on file ${c.id} failed: ${(err as Error).message}`,
        );
      }
    }

    if (backfilled > 0 || reverified > 0 || violations > 0) {
      this.logger.log(
        `integrity verifier: backfilled=${backfilled} reverified=${reverified} violations=${violations}`,
      );
    }
    return { candidates: candidates.length, backfilled, reverified, violations };
  }

  /**
   * Provider-specific download + hash. Returns null when the provider
   * isn't wired for downloading (the cron emits a backfill event instead
   * of failing). Implemented as a separate method so the storage
   * integrations team can plug in MediaStorageAdapter.download() and
   * R2Adapter.getObject() later without churning the cron logic.
   */
  private async fetchAndHash(
    _provider: string,
    _storageKey: string,
  ): Promise<string | null> {
    // v1: not wired. The follow-up PR will inject MediaStorageAdapter +
    // R2Adapter and switch on `provider`. Returning null keeps the
    // cron useful (event-emit path) without forcing the integrations
    // PR to land first.
    return null;
  }

  private async emitBackfillPending(
    fileId: string,
    provider: string,
  ): Promise<void> {
    try {
      await this.eventBus.publish({
        eventName: 'file.integrity.backfill_pending',
        aggregate: 'FileMetadata',
        aggregateId: fileId,
        occurredAt: new Date(),
        payload: { fileId, provider },
      });
    } catch {
      // events are best-effort
    }
  }

  private async emitViolation(
    fileId: string,
    expected: string,
    actual: string,
  ): Promise<void> {
    try {
      await this.eventBus.publish({
        eventName: 'file.integrity.violation',
        aggregate: 'FileMetadata',
        aggregateId: fileId,
        occurredAt: new Date(),
        payload: {
          fileId,
          expectedSha256: expected,
          actualSha256: actual,
          severity: 'HIGH',
        },
      });
    } catch {
      // events are best-effort
    }
  }
}
