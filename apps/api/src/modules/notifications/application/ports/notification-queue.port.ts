import type { NotificationChannel } from '@prisma/client';

export const NOTIFICATION_QUEUE = Symbol('NOTIFICATION_QUEUE');

export interface NotificationJob {
  /** Generated server-side at enqueue time. */
  id: string;
  channel: NotificationChannel;
  /** Either a platform user id (worker resolves email/phone) or a raw
   *  destination — see destination field. Exactly one must be set. */
  recipientId?: string;
  destination?: string;
  templateKey?: string;
  subject?: string;
  body: string;
  /** Polymorphic linkage to what triggered this notification. */
  eventType?: string;
  eventId?: string;
  /** Internal — bumped on each retry; max 3. */
  attemptNumber: number;
  /** When the worker should pick this up. Past = process immediately. */
  scheduledFor: number; // epoch ms
}

/**
 * Queue abstraction. Today: Redis list (LPUSH/RPOP). Tomorrow: BullMQ.
 * Call sites stay the same.
 */
export interface INotificationQueue {
  /** Enqueue at the tail of the queue. Returns the generated job id. */
  enqueue(job: Omit<NotificationJob, 'id' | 'attemptNumber' | 'scheduledFor'> & {
    attemptNumber?: number;
    scheduledFor?: number;
  }): Promise<string>;

  /** Pop the next eligible job (scheduledFor <= now) or null if empty. */
  dequeue(): Promise<NotificationJob | null>;

  /** Re-enqueue with a delay for retry. */
  scheduleRetry(job: NotificationJob, delayMs: number): Promise<void>;

  /** Move to dead-letter queue after exhausting retries. */
  pushDeadLetter(job: NotificationJob, reason: string): Promise<void>;
}
