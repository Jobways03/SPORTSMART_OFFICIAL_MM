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
  /** Phase 185 (#17) — provenance: EVENT_BUS:<event> | ADMIN_DISPATCH |
   *  CRON:<job> | DLQ_REPLAY | TEST_SEND. Persisted on the log row. */
  triggerSource?: string;
  /** Phase 185 (#4) — TRAI DLT ids resolved from the template at enqueue
   *  time; the SMS provider enforces their presence. */
  dltTemplateId?: string | null;
  dltHeaderId?: string | null;
  /** Phase 190 (#4) — trace linkage carried onto the log row. */
  parentLogId?: string | null;
  outboxEventId?: string | null;
  /**
   * Cluster-D fix — safety-critical send (OTP, password reset, refund
   * credited). The send-time gate (NotificationWorker.handle) honours this
   * exactly like NotificationGateService.GateInput.transactional: the
   * suppression list + WhatsApp STOP still hard-block, but user preference
   * and DPDP marketing-consent are bypassed. Absent/false = fully gated.
   */
  transactional?: boolean;
  /** Internal — bumped on each retry; max 3. */
  attemptNumber: number;
  /** When the worker should pick this up. Past = process immediately. */
  scheduledFor: number; // epoch ms
}

/** Phase 185 (#12) — a dead-lettered job with its failure context. */
export interface DeadLetterEntry {
  job: NotificationJob;
  reason: string;
  deadLetteredAt: number;
}

/** Phase 185 (#9/#12) — queue depth snapshot for ops observability. */
export interface QueueStats {
  ready: number;
  delayed: number;
  deadLetter: number;
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

  // ── Phase 185 (#12) — DLQ ops surface ───────────────────────────────
  /** List dead-lettered jobs (newest first), paginated. */
  listDeadLetters(offset: number, limit: number): Promise<{ items: DeadLetterEntry[]; total: number }>;
  /** Remove the dead-letter at `index` and re-enqueue its job (attempt
   *  counter reset). Returns the new job id, or null if the index is gone. */
  replayDeadLetter(index: number): Promise<string | null>;
  /** Drop a dead-letter without replaying it. Returns the removed entry
   *  (so the caller can record a CANCELLED log row), or null if gone. */
  discardDeadLetter(index: number): Promise<DeadLetterEntry | null>;
  /** Queue-depth snapshot for observability. */
  getStats(): Promise<QueueStats>;
}
