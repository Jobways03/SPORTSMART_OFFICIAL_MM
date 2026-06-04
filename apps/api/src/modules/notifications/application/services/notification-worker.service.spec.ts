/**
 * Cluster-D — send-time gate is load-bearing.
 *
 * Pre-fix, NotificationGateService.check() was invoked ONLY by the admin
 * retry controller; the queue-driven worker -> router.dispatch -> provider
 * path NEVER called it, so the suppression list / DPDP consent / opt-out were
 * silently bypassed on every normal send.
 *
 * These specs pin the fix: the worker MUST call gate.check() before
 * dispatching, MUST NOT dispatch a gate-denied recipient, MUST record the
 * suppression in the notification log, and still dispatches an allowed one.
 * The spec drives the public tick() loop so the queue + per-tick audit
 * summary are exercised too.
 */
import 'reflect-metadata';
import type { NotificationJob } from '../ports/notification-queue.port';
import { NotificationWorker } from './notification-worker.service';

function buildJob(overrides: Partial<NotificationJob> = {}): NotificationJob {
  return {
    id: 'job-1',
    channel: 'EMAIL',
    recipientId: 'u-1',
    body: 'hello',
    eventType: 'order',
    attemptNumber: 1,
    scheduledFor: Date.now(),
    ...overrides,
  };
}

/** A queue that serves exactly the supplied jobs once, then nothing. */
function buildQueue(jobs: NotificationJob[]) {
  const remaining = [...jobs];
  return {
    enqueue: jest.fn(),
    dequeue: jest.fn().mockImplementation(async () => remaining.shift() ?? null),
    scheduleRetry: jest.fn(),
    pushDeadLetter: jest.fn(),
    listDeadLetters: jest.fn(),
    replayDeadLetter: jest.fn(),
    discardDeadLetter: jest.fn(),
    getStats: jest.fn().mockResolvedValue({ ready: 0, delayed: 0, deadLetter: 0 }),
  } as any;
}

function makeWorker(opts: {
  jobs: NotificationJob[];
  gateDecision?: { allowed: true } | { allowed: false; reason: string };
  destination?: string | null;
  dispatchResult?: { success: boolean; retryable?: boolean; failureReason?: string };
}) {
  const queue = buildQueue(opts.jobs);
  const router = {
    dispatch: jest
      .fn()
      .mockResolvedValue(opts.dispatchResult ?? { success: true, providerMessageId: 'smtp-ok' }),
  } as any;
  const logRepo = {
    recordAttempt: jest.fn().mockResolvedValue({}),
    recordCancellation: jest.fn().mockResolvedValue({}),
  } as any;
  const prisma = {} as any;
  const recipients = {
    resolve: jest.fn().mockResolvedValue({
      found: true,
      destination: opts.destination === undefined ? 'user@example.com' : opts.destination,
    }),
  } as any;
  const gate = {
    check: jest.fn().mockResolvedValue(opts.gateDecision ?? { allowed: true }),
  } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;

  const worker = new NotificationWorker(queue, router, logRepo, prisma, recipients, gate, audit);
  return { worker, queue, router, logRepo, recipients, gate, audit };
}

describe('NotificationWorker — send-time gate (Cluster-D)', () => {
  it('invokes gate.check() before dispatching and dispatches an allowed recipient', async () => {
    const { worker, router, gate, logRepo } = makeWorker({
      jobs: [buildJob()],
      gateDecision: { allowed: true },
    });

    await (worker as any).tick();

    expect(gate.check).toHaveBeenCalledTimes(1);
    expect(gate.check).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        destination: 'user@example.com',
        recipientUserId: 'u-1',
        eventClass: 'order',
        transactional: false,
      }),
    );
    expect(router.dispatch).toHaveBeenCalledTimes(1);
    expect(logRepo.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ finalStatus: 'SENT' }),
    );
  });

  it('does NOT dispatch a gate-denied (suppressed) recipient and records the suppression', async () => {
    const { worker, router, gate, logRepo } = makeWorker({
      jobs: [buildJob()],
      gateDecision: { allowed: false, reason: 'suppressed: BOUNCED' },
    });

    await (worker as any).tick();

    expect(gate.check).toHaveBeenCalledTimes(1);
    // The load-bearing assertion: a suppressed recipient is never dispatched.
    expect(router.dispatch).not.toHaveBeenCalled();

    // A suppression row is written (FAILED) carrying the gate's reason.
    expect(logRepo.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        finalStatus: 'FAILED',
        destination: 'user@example.com',
        result: expect.objectContaining({
          failureReason: expect.stringContaining('suppressed: BOUNCED'),
          retryable: false,
        }),
      }),
    );
    expect(worker.getMetrics().suppressed).toBe(1);
  });

  it('passes the job.transactional flag through to the gate (bypass plumbing)', async () => {
    const { worker, gate } = makeWorker({
      jobs: [buildJob({ transactional: true, eventType: 'security' })],
      gateDecision: { allowed: true },
    });

    await (worker as any).tick();

    expect(gate.check).toHaveBeenCalledWith(
      expect.objectContaining({ transactional: true, eventClass: 'security' }),
    );
  });

  it('writes one best-effort per-tick audit summary with sent/failed/suppressed counts', async () => {
    const { worker, audit } = makeWorker({
      jobs: [buildJob({ id: 'a' }), buildJob({ id: 'b', recipientId: 'u-2' })],
      gateDecision: { allowed: true },
    });

    await (worker as any).tick();

    // Exactly one summary row for the whole tick (not one per send).
    expect(audit.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'notifications.worker.tick',
        module: 'notifications',
        newValue: expect.objectContaining({ batchSize: 2, sent: 2, failed: 0, suppressed: 0 }),
      }),
    );
  });

  it('a failing audit-summary write never aborts the sweep', async () => {
    const { worker, audit, router } = makeWorker({
      jobs: [buildJob()],
      gateDecision: { allowed: true },
    });
    audit.writeAuditLog.mockRejectedValueOnce(new Error('audit down'));

    // Must not throw.
    await expect((worker as any).tick()).resolves.toBeUndefined();
    // The send still happened.
    expect(router.dispatch).toHaveBeenCalledTimes(1);
  });
});
