import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { RefundProcessorService } from '../../src/modules/returns/application/services/refund-processor.service';

/**
 * Phase 167 review guard (#4 / #9).
 *
 * Audit #167 reported the refund processor's loop as "not leader-fenced /
 * unobserved (setInterval)". FALSE POSITIVE — Phase 101 already migrated it to
 * @Cron + LeaderElectedCron + CronInstrumentation. But that protective property
 * was UNPINNED: the only spec touching the service (returns-logic.spec.ts) just
 * asserts a skip rule. If a refactor dropped `leader.run(...)`, NOTHING would
 * fail — and two replicas would both process the same refund row (duplicate
 * gateway calls / double money movement).
 *
 * This guard pins three things:
 *   1. run() is decorated @Cron (it's actually scheduled — a runtime mock can't
 *      observe the decorator, so we assert it at the source level).
 *   2. run() routes the work through leader.run('refund-processor', ...) so only
 *      one replica processes at a time.
 *   3. that lease wraps instrumentation.wrap('returns.refund_processor', ...) so
 *      every tick lands a cron_runs metric row.
 *   4. the enable-gate short-circuits before acquiring the lease.
 */

function makeService(opts: { enabled: boolean }) {
  const leader = {
    run: jest.fn(async (_name: string, _ttl: number, cb: () => Promise<void>) => {
      // invoke the leased body so instrumentation.wrap is reached...
      await cb();
    }),
  };
  const instrumentation = {
    // ...but do NOT invoke the inner body, so pollPendingRefunds/retry never run
    // (keeps the test free of prisma/gateway wiring — we only assert fencing).
    wrap: jest.fn(async (_name: string, _cb: () => Promise<unknown>) => undefined),
  };
  const envService = {
    getNumber: (key: string, fallback: number) =>
      key === 'REFUND_POLL_INTERVAL_SECONDS' ? (opts.enabled ? 120 : 0) : fallback,
  };
  const svc = new RefundProcessorService(
    {} as any, // prisma — unreached
    {} as any, // redis — unreached on the @Cron path
    envService as any,
    {} as any, // returnService — unreached
    {} as any, // refundGateway — unreached
    leader as any,
    instrumentation as any,
    { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any, // audit (Phase 214)
  );
  return { svc, leader, instrumentation };
}

describe('RefundProcessorService fencing (Phase 167 guard #4/#9)', () => {
  it('run() acquires the leader lease then wraps the work in cron instrumentation', async () => {
    const { svc, leader, instrumentation } = makeService({ enabled: true });
    await svc.run();
    expect(leader.run).toHaveBeenCalledWith(
      'refund-processor',
      expect.any(Number),
      expect.any(Function),
    );
    expect(instrumentation.wrap).toHaveBeenCalledWith(
      'returns.refund_processor',
      expect.any(Function),
    );
  });

  it('run() short-circuits without taking the lease when disabled by env', async () => {
    const { svc, leader, instrumentation } = makeService({ enabled: false });
    await svc.run();
    expect(leader.run).not.toHaveBeenCalled();
    expect(instrumentation.wrap).not.toHaveBeenCalled();
  });

  it('run() is decorated @Cron (actually scheduled, not a manual/test-only tick)', () => {
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../src/modules/returns/application/services/refund-processor.service.ts',
      ),
      'utf8',
    );
    // @Cron(...) must immediately precede `async run(` (allowing a trailing
    // inline comment on the decorator line).
    expect(src).toMatch(/@Cron\([^\n]*\)[^\n]*\n\s*async run\(/);
  });
});
