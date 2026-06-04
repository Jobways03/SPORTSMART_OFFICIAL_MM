import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  INotificationQueue,
  NOTIFICATION_QUEUE,
  NotificationJob,
} from '../ports/notification-queue.port';
import { NotificationRouter } from './notification-router.service';
import { RecipientResolverService } from './recipient-resolver.service';
import { NotificationGateService } from './notification-gate.service';
import { NotificationLogRepository } from '../../infrastructure/persistence/prisma/notification-log.repository';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

const TICK_INTERVAL_MS = 500;
const MAX_JOBS_PER_TICK = 10;
const MAX_ATTEMPTS = 3;
// Exponential backoff: 30s · 2m · 8m
const RETRY_DELAYS_MS = [30_000, 120_000, 480_000];

// Phase 10 (2026-05-16) — within-batch concurrency.
//
// The pre-Phase-10 worker awaited each dispatch sequentially, so one
// slow provider call (e.g. a 5s WhatsApp retry storm) stalled the
// entire batch behind it. At 500ms × 10 jobs = 20/sec theoretical
// ceiling, the queue would silently back up during email bursts.
//
// We now process each batch via Promise.allSettled — every job in
// the batch dispatches in parallel; settled when all return. Setting
// this cap higher than MAX_JOBS_PER_TICK has no effect (the batch
// size IS the upper bound). Lower it if a provider gets unhappy
// under parallel load.
const MAX_CONCURRENT_DISPATCH = 10;

/**
 * Polling worker — pulls notification jobs off the Redis queue, resolves
 * the recipient destination (when the job carries a `recipientId`),
 * dispatches via the channel router, and writes an audit row.
 *
 * Failures with `retryable=true` get re-enqueued with exponential
 * backoff up to MAX_ATTEMPTS; beyond that they go to the DLQ.
 *
 * Single-process today (one worker per API instance). When/if we run
 * multiple instances the LPOP semantics already guarantee at-most-once
 * dispatch; no extra coordination needed.
 */
@Injectable()
export class NotificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorker.name);
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  // Phase 185 (#9) — lightweight observability for the polling worker.
  //
  // The audit suggested converting this to a LeaderElectedCron. That would
  // be WRONG for a queue worker: leader-election runs the loop on exactly
  // ONE replica, which REDUCES throughput. The correct horizontal-scale
  // model for a work queue is competing-consumers — every replica LPOPs,
  // and Redis LPOP atomicity already guarantees at-most-once dispatch
  // across replicas (documented below). What was genuinely missing was
  // visibility, so we count processed/failed and emit a periodic heartbeat
  // with queue depth instead of changing the (correct) concurrency model.
  private processedCount = 0;
  private failedCount = 0;
  // Cluster-D — count gate denials (suppression / opt-out / no-consent) so the
  // per-tick audit summary can report what was blocked at send time.
  private suppressedCount = 0;
  private tickCount = 0;
  // 500ms tick × 120 = ~60s between heartbeats.
  private static readonly HEARTBEAT_EVERY_TICKS = 120;
  // Cluster-D — counters captured at the start of each tick so the audit
  // summary row reports the DELTA for that tick, not lifetime totals.
  private tickStartProcessed = 0;
  private tickStartFailed = 0;
  private tickStartSuppressed = 0;

  constructor(
    @Inject(NOTIFICATION_QUEUE) private readonly queue: INotificationQueue,
    private readonly router: NotificationRouter,
    private readonly logRepo: NotificationLogRepository,
    private readonly prisma: PrismaService,
    // Phase 187 — single source of truth for recipientId → destination.
    private readonly recipients: RecipientResolverService,
    // Cluster-D — authoritative send-time suppression / consent / opt-out gate.
    // Previously invoked ONLY by the admin retry controller, so every
    // queue-driven send bypassed it. Now load-bearing in handle().
    private readonly gate: NotificationGateService,
    // Cluster-D — best-effort per-TICK audit summary (one row per tick, not
    // per send). Wrapped so a logging failure never aborts the sweep.
    private readonly audit: AuditPublicFacade,
  ) {}

  /** Ops/test accessor for the worker's running counters. */
  getMetrics(): { processed: number; failed: number; suppressed: number; ticks: number } {
    return {
      processed: this.processedCount,
      failed: this.failedCount,
      suppressed: this.suppressedCount,
      ticks: this.tickCount,
    };
  }

  onModuleInit() {
    if (process.env.NOTIFICATION_WORKER_ENABLED === 'false') {
      this.logger.log('Notification worker disabled via env');
      return;
    }
    this.interval = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    this.logger.log(`Notification worker running (tick=${TICK_INTERVAL_MS}ms)`);
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return; // skip overlapping ticks
    this.running = true;
    this.tickCount++;
    // Phase 185 (#9) — periodic heartbeat with queue depth so ops can spot
    // a backing-up queue (e.g. a Diwali-sale burst) before it overflows.
    if (this.tickCount % NotificationWorker.HEARTBEAT_EVERY_TICKS === 0) {
      this.queue
        .getStats()
        .then((s) =>
          this.logger.log(
            `worker heartbeat — processed=${this.processedCount} failed=${this.failedCount} ` +
              `ready=${s.ready} delayed=${s.delayed} dlq=${s.deadLetter}`,
          ),
        )
        .catch(() => undefined);
    }
    try {
      // Phase 10 (2026-05-16) — drain up to MAX_JOBS_PER_TICK in
      // parallel. Dequeue is still sequential (LPOP is atomic; an
      // attempted batch-pop would either need MULTI/EXEC or an
      // LMPOP, neither of which buy us much over N small pops).
      // The dispatch step is where the wall-clock goes; parallel
      // there alone lifts the per-tick ceiling from 10/sec to roughly
      // (10 / slowest-provider-RTT).
      const jobs: NotificationJob[] = [];
      for (let i = 0; i < MAX_JOBS_PER_TICK; i++) {
        const job = await this.queue.dequeue();
        if (!job) break;
        jobs.push(job);
      }
      if (jobs.length === 0) return;

      // Cluster-D — snapshot the counters so the post-tick audit summary
      // reports only what happened THIS tick.
      this.tickStartProcessed = this.processedCount;
      this.tickStartFailed = this.failedCount;
      this.tickStartSuppressed = this.suppressedCount;

      // Each handle() catches its own provider errors and writes its
      // own audit row, so a single failure doesn't poison the batch.
      // allSettled rather than all so a thrown exception (rare —
      // handle() catches internally) still settles the other jobs.
      const slice = jobs.slice(0, MAX_CONCURRENT_DISPATCH);
      await Promise.allSettled(slice.map((job) => this.handle(job)));
      // If the batch ever exceeds MAX_CONCURRENT_DISPATCH (won't
      // today, but the constant decoupling is intentional), drain
      // the remainder serially. Belt + braces.
      for (let i = MAX_CONCURRENT_DISPATCH; i < jobs.length; i++) {
        await this.handle(jobs[i]!);
      }

      // Cluster-D — one best-effort audit summary row per tick (NOT per send,
      // which would be far too high-volume). Runs AFTER the batch settles, so
      // it is outside every per-row notification-log write; a failure here is
      // swallowed and never aborts the sweep.
      await this.writeTickAudit(jobs.length);
    } catch (err) {
      this.logger.error(`Worker tick crashed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async handle(job: NotificationJob): Promise<void> {
    const destination = await this.resolveDestination(job);
    if (!destination) {
      await this.logRepo.recordAttempt({
        job,
        destination: '(unresolved)',
        result: {
          success: false,
          failureReason: `Could not resolve destination for ${job.recipientId ?? job.destination}`,
        },
        finalStatus: 'FAILED',
      });
      return;
    }

    // Cluster-D (CRITICAL) — authoritative send-time gate. This was DEAD
    // CODE in the queue-driven path: gate.check() ran ONLY in the admin
    // retry controller, so suppression-list / DPDP-consent / opt-out were
    // silently bypassed on every normal send. The gate keeps its own
    // transactional/critical bypass (the suppression list + WhatsApp STOP
    // still hard-block; preference + marketing-consent are bypassed only
    // when the job is flagged transactional). On a denial we record the
    // suppression in the notification log and do NOT dispatch.
    const decision = await this.gate.check({
      channel: job.channel,
      destination,
      // recipientId is a platform actor id (User/Seller/Admin/Franchise/
      // Affiliate). The gate's preference + consent lookups key on the User
      // table; a non-user id simply finds no preference/consent row and
      // falls through to "allow" — same mapping the admin retry path uses.
      recipientUserId: job.recipientId ?? null,
      eventClass: job.eventType ?? 'order',
      transactional: job.transactional === true,
    });
    if (!decision.allowed) {
      this.suppressedCount++;
      await this.logRepo.recordAttempt({
        job,
        destination,
        result: {
          success: false,
          // `deriveFailureCode` maps "suppressed"/"opted out" to
          // BLOCKED_BY_SUPPRESSION / BLOCKED_BY_PREFERENCE.
          failureReason: `Suppressed at send gate: ${decision.reason}`,
          retryable: false,
        },
        finalStatus: 'FAILED',
      });
      this.logger.log(
        `Suppressed ${job.channel} → ${destination} (${decision.reason})`,
      );
      return;
    }

    const result = await this.router.dispatch(job.channel, {
      to: destination,
      subject: job.subject,
      body: job.body,
      templateKey: job.templateKey,
      // Phase 185 (#4) — DLT ids resolved at enqueue time; SMS provider
      // enforces them.
      dltTemplateId: job.dltTemplateId,
      dltHeaderId: job.dltHeaderId,
    });

    if (result.success) {
      this.processedCount++;
      await this.logRepo.recordAttempt({
        job,
        destination,
        result,
        finalStatus: 'SENT',
      });
      return;
    }

    this.failedCount++;

    // Failed. Decide: hard fail vs retry.
    if (result.retryable && job.attemptNumber < MAX_ATTEMPTS) {
      const delay = RETRY_DELAYS_MS[job.attemptNumber - 1] ?? RETRY_DELAYS_MS.at(-1)!;
      await this.logRepo.recordAttempt({
        job,
        destination,
        result,
        finalStatus: 'RETRY',
      });
      await this.queue.scheduleRetry(job, delay);
      return;
    }

    // Phase 190 (#2) — a retryable job that exhausted its attempts is
    // DEAD_LETTERED (distinct terminal state); a non-retryable hard fail is
    // FAILED. This gives DEAD_LETTERED a real writer + lets ops filter it.
    const deadLettered = result.retryable === true;
    await this.logRepo.recordAttempt({
      job,
      destination,
      result,
      finalStatus: deadLettered ? 'DEAD_LETTERED' : 'FAILED',
    });
    if (deadLettered) {
      await this.queue.pushDeadLetter(
        job,
        result.failureReason ?? 'max retries exceeded',
      );
    }
  }

  /**
   * Cluster-D — best-effort per-TICK audit summary (sent / failed /
   * suppressed counts for the jobs drained this tick). Deliberately ONE row
   * per tick, never per send: a per-send audit row would dwarf the
   * notification log itself. Best-effort — a failure to write the summary
   * must never abort or fail the sweep, so we swallow it.
   */
  private async writeTickAudit(batchSize: number): Promise<void> {
    const sent = this.processedCount - this.tickStartProcessed;
    const failed = this.failedCount - this.tickStartFailed;
    const suppressed = this.suppressedCount - this.tickStartSuppressed;
    try {
      await this.audit.writeAuditLog({
        actorId: 'system',
        actorRole: 'SYSTEM',
        actorType: 'SYSTEM',
        action: 'notifications.worker.tick',
        module: 'notifications',
        resource: 'NotificationWorker',
        newValue: { batchSize, sent, failed, suppressed },
      });
    } catch (err) {
      // Swallow — the dispatches already happened + were logged per-row.
      this.logger.warn(`worker tick audit write failed: ${(err as Error).message}`);
    }
  }

  /**
   * If the job specifies a destination directly, use it. Otherwise look
   * up the recipient in User/Seller/Admin/FranchisePartner/Affiliate by
   * id and pick the right field (email vs phone) for the channel.
   */
  private async resolveDestination(job: NotificationJob): Promise<string | null> {
    if (job.destination) return job.destination;
    if (!job.recipientId) return null;
    // Phase 187 — delegate to the shared resolver (same lookup order).
    const { destination } = await this.recipients.resolve(job.recipientId, job.channel);
    return destination;
  }
}
