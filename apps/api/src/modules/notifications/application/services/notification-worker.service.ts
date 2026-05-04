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
import { NotificationLogRepository } from '../../infrastructure/persistence/prisma/notification-log.repository';

const TICK_INTERVAL_MS = 500;
const MAX_JOBS_PER_TICK = 10;
const MAX_ATTEMPTS = 3;
// Exponential backoff: 30s · 2m · 8m
const RETRY_DELAYS_MS = [30_000, 120_000, 480_000];

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

  constructor(
    @Inject(NOTIFICATION_QUEUE) private readonly queue: INotificationQueue,
    private readonly router: NotificationRouter,
    private readonly logRepo: NotificationLogRepository,
    private readonly prisma: PrismaService,
  ) {}

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
    try {
      for (let i = 0; i < MAX_JOBS_PER_TICK; i++) {
        const job = await this.queue.dequeue();
        if (!job) break;
        await this.handle(job);
      }
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

    const result = await this.router.dispatch(job.channel, {
      to: destination,
      subject: job.subject,
      body: job.body,
      templateKey: job.templateKey,
    });

    if (result.success) {
      await this.logRepo.recordAttempt({
        job,
        destination,
        result,
        finalStatus: 'SENT',
      });
      return;
    }

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

    await this.logRepo.recordAttempt({
      job,
      destination,
      result,
      finalStatus: 'FAILED',
    });
    if (result.retryable) {
      // Out of retries.
      await this.queue.pushDeadLetter(
        job,
        result.failureReason ?? 'max retries exceeded',
      );
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

    const wantsPhone = job.channel === 'SMS' || job.channel === 'WHATSAPP';

    const user = await this.prisma.user.findUnique({
      where: { id: job.recipientId },
      select: { email: true, phone: true },
    });
    if (user) return wantsPhone ? user.phone : user.email;

    const seller = await this.prisma.seller.findUnique({
      where: { id: job.recipientId },
      select: { email: true, phoneNumber: true },
    });
    if (seller) return wantsPhone ? seller.phoneNumber : seller.email;

    const admin = await this.prisma.admin.findUnique({
      where: { id: job.recipientId },
      select: { email: true },
    });
    if (admin) return wantsPhone ? null : admin.email;

    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: job.recipientId },
      select: { email: true, phoneNumber: true },
    });
    if (franchise) return wantsPhone ? franchise.phoneNumber : franchise.email;

    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: job.recipientId },
      select: { email: true, phone: true },
    });
    if (affiliate) return wantsPhone ? affiliate.phone : affiliate.email;

    return null;
  }
}
