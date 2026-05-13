import { CronJobsService } from './cron-jobs.service';

/**
 * Phase 1 (PR 1.2) — sample-coverage that the LeaderElectedCron
 * wrapper is actually invoked from a real @Cron method. The helper
 * itself has full unit coverage in `leader-elected-cron.spec.ts`;
 * here we just pin the wiring per cron service so a future refactor
 * can't quietly un-wrap a body.
 *
 * CronJobsService is the densest cron service (4 methods), so it's
 * the natural sentinel for the migration. The other 10 cron files
 * apply the same wrapper shape — repeating identical wiring tests
 * for each would add ~30 LoC of noise per file for one line of
 * substance. The helper spec already covers the semantics.
 */

function buildService(opts: { leaderWins?: boolean } = {}) {
  const lowStock = { sweep: jest.fn().mockResolvedValue({ flagged: 0 }) };
  const recon = { runAndCollect: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    ticket: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    fileMetadata: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  } as any;
  const leader = {
    run: jest.fn(async (_name: string, _ttl: number, body: () => Promise<void>) => {
      if (opts.leaderWins === false) return { ran: false };
      await body();
      return { ran: true };
    }),
  } as any;
  // Phase 5 (PR 5.4) — pass-through instr so the existing leader-
  // election assertions still observe the underlying lowStock /
  // recon / prisma calls.
  const instr = {
    wrap: jest.fn(async (_n: string, fn: () => Promise<unknown>) => fn()),
  } as any;
  const service = new CronJobsService(prisma, lowStock as any, recon as any, leader, instr);
  return { service, prisma, lowStock, recon, leader, instr };
}

describe('CronJobsService — leader-election wrapping (PR 1.2)', () => {
  it('hourlyLowStockSweep is wrapped by LeaderElectedCron', async () => {
    const { service, leader, lowStock } = buildService({});
    await service.hourlyLowStockSweep();
    expect(leader.run).toHaveBeenCalledWith(
      'hourly-low-stock-sweep',
      expect.any(Number),
      expect.any(Function),
    );
    expect(lowStock.sweep).toHaveBeenCalledTimes(1);
  });

  it('SKIPS the body when leader-election loses (multi-replica safety)', async () => {
    const { service, lowStock } = buildService({ leaderWins: false });
    await service.hourlyLowStockSweep();
    // The headline assertion: when another replica holds the lock,
    // the cron body is NOT invoked on this replica.
    expect(lowStock.sweep).not.toHaveBeenCalled();
  });

  it('ticketSlaBreachCheck is wrapped with the right job key', async () => {
    const { service, leader } = buildService({});
    await service.ticketSlaBreachCheck();
    expect(leader.run).toHaveBeenCalledWith(
      'ticket-sla-breach',
      expect.any(Number),
      expect.any(Function),
    );
  });

  it('dailyReconciliation runs all 5 kinds in one wrapped body', async () => {
    const { service, leader, recon } = buildService({});
    await service.dailyReconciliation();
    expect(leader.run).toHaveBeenCalledWith(
      'daily-reconciliation',
      expect.any(Number),
      expect.any(Function),
    );
    // All 5 recon kinds invoked under the single lock.
    expect(recon.runAndCollect).toHaveBeenCalledTimes(5);
  });

  it('cleanupStalePendingFiles is wrapped', async () => {
    const { service, leader, prisma } = buildService({});
    await service.cleanupStalePendingFiles();
    expect(leader.run).toHaveBeenCalledWith(
      'cleanup-stale-pending-files',
      expect.any(Number),
      expect.any(Function),
    );
    expect(prisma.fileMetadata.updateMany).toHaveBeenCalled();
  });

  it('each method uses a UNIQUE job key (no accidental sharing)', async () => {
    const { service, leader } = buildService({});
    await service.hourlyLowStockSweep();
    await service.ticketSlaBreachCheck();
    await service.dailyReconciliation();
    await service.cleanupStalePendingFiles();

    const keys = leader.run.mock.calls.map((c: any) => c[0]);
    expect(new Set(keys).size).toBe(keys.length); // all unique
    expect(keys.sort()).toEqual([
      'cleanup-stale-pending-files',
      'daily-reconciliation',
      'hourly-low-stock-sweep',
      'ticket-sla-breach',
    ]);
  });
});
