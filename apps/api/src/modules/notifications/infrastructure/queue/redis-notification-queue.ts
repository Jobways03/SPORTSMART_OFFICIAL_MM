import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import {
  INotificationQueue,
  NotificationJob,
} from '../../application/ports/notification-queue.port';

const QUEUE_KEY = 'notifications:queue';      // ready jobs
const DELAYED_KEY = 'notifications:delayed';   // sorted set, score = scheduledFor (ms)
const DLQ_KEY = 'notifications:dlq';           // dead-lettered after N retries

/**
 * Simple Redis-backed queue for notification jobs.
 *
 * Ready jobs live in a list (FIFO via RPUSH + LPOP). Jobs that need to
 * fire at a future time go into a sorted set keyed by scheduled-for
 * epoch-ms; the worker promotes any due jobs into the ready list on
 * each tick.
 *
 * Designed so the public `INotificationQueue` interface is identical
 * to what BullMQ would expose — swapping to BullMQ later is a single
 * provider replacement, no call-site changes.
 */
@Injectable()
export class RedisNotificationQueue implements INotificationQueue {
  private readonly logger = new Logger(RedisNotificationQueue.name);

  constructor(private readonly redis: RedisService) {}

  async enqueue(
    job: Omit<NotificationJob, 'id' | 'attemptNumber' | 'scheduledFor'> & {
      attemptNumber?: number;
      scheduledFor?: number;
    },
  ): Promise<string> {
    const id = randomUUID();
    const full: NotificationJob = {
      id,
      channel: job.channel,
      recipientId: job.recipientId,
      destination: job.destination,
      templateKey: job.templateKey,
      subject: job.subject,
      body: job.body,
      eventType: job.eventType,
      eventId: job.eventId,
      attemptNumber: job.attemptNumber ?? 1,
      scheduledFor: job.scheduledFor ?? Date.now(),
    };
    const client = this.redis.getClient();
    const payload = JSON.stringify(full);

    if (full.scheduledFor <= Date.now()) {
      // Ready immediately — push to the ready list.
      await client.rpush(QUEUE_KEY, payload);
    } else {
      // Future job — park in delayed set; worker promotes on tick.
      await client.zadd(DELAYED_KEY, full.scheduledFor, payload);
    }
    return id;
  }

  async dequeue(): Promise<NotificationJob | null> {
    const client = this.redis.getClient();

    // 1. Promote any due delayed jobs into the ready list.
    const now = Date.now();
    const due = await client.zrangebyscore(DELAYED_KEY, 0, now);
    if (due.length > 0) {
      const pipeline = client.multi();
      for (const item of due) {
        pipeline.rpush(QUEUE_KEY, item);
        pipeline.zrem(DELAYED_KEY, item);
      }
      await pipeline.exec();
    }

    // 2. Pop the next ready job.
    const raw = await client.lpop(QUEUE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as NotificationJob;
    } catch (err) {
      this.logger.error(`Malformed job payload — discarding: ${(err as Error).message}`);
      return null;
    }
  }

  async scheduleRetry(job: NotificationJob, delayMs: number): Promise<void> {
    const next: NotificationJob = {
      ...job,
      attemptNumber: job.attemptNumber + 1,
      scheduledFor: Date.now() + delayMs,
    };
    await this.redis
      .getClient()
      .zadd(DELAYED_KEY, next.scheduledFor, JSON.stringify(next));
  }

  async pushDeadLetter(job: NotificationJob, reason: string): Promise<void> {
    const entry = JSON.stringify({ job, reason, deadLetteredAt: Date.now() });
    await this.redis.getClient().rpush(DLQ_KEY, entry);
    this.logger.warn(
      `Job ${job.id} (${job.channel}) dead-lettered after ${job.attemptNumber} attempts: ${reason}`,
    );
  }
}
