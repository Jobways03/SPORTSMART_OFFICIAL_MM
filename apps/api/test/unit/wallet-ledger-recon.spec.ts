import 'reflect-metadata';
import { WalletLedgerReconCron } from '../../src/modules/reconciliation/application/jobs/wallet-ledger-recon.cron';

/**
 * Phase 3 (PR 3.5) — wallet ledger reconciliation cron.
 *
 * Behaviour to pin:
 *   - Flag-OFF: tick is a no-op (no DB / Redis / event traffic).
 *   - Skips when the Redis lock is unavailable.
 *   - Reconciles wallets one batch at a time using a cursor scan.
 *   - When ledger sum != balance, emits `wallet.ledger.drift_detected`.
 *   - Lock is released on the happy path AND on errors.
 */
describe('WalletLedgerReconCron', () => {
  function buildCron(opts: {
    enabled?: boolean;
    lockAvailable?: boolean;
    walletBatches?: Array<Array<{ id: string; userId: string; balanceInPaise: number }>>;
    sumByWallet?: Record<string, number>;
  }) {
    const lockAvailable = opts.lockAvailable ?? true;
    const batches = opts.walletBatches ?? [];
    const findManyCalls: number[] = [];
    const prisma = {
      wallet: {
        findMany: jest.fn(async () => {
          const next = batches.shift() ?? [];
          findManyCalls.push(next.length);
          return next;
        }),
      },
      walletTransaction: {
        aggregate: jest.fn(async (args: { where: { walletId: string } }) => {
          const sum = opts.sumByWallet?.[args.where.walletId] ?? null;
          return { _sum: { amountInPaise: sum } };
        }),
      },
    };
    const redis = {
      acquireLock: jest.fn().mockResolvedValue(lockAvailable),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };
    const env = {
      getBoolean: jest.fn().mockReturnValue(opts.enabled ?? false),
      getNumber: jest.fn().mockImplementation((k: string, d: number) => d),
    };
    const events = { publish: jest.fn().mockResolvedValue(undefined) };
    const cron = new WalletLedgerReconCron(
      prisma as never,
      redis as never,
      env as never,
      events as never,
    );
    return { cron, prisma, redis, events };
  }

  it('no-ops when flag is off', async () => {
    const { cron, redis } = buildCron({ enabled: false });
    const result = await cron.tick();
    expect(result).toEqual({ reconciled: 0, drifted: 0 });
    expect(redis.acquireLock).not.toHaveBeenCalled();
  });

  it('skips when lock is unavailable', async () => {
    const { cron, prisma } = buildCron({
      enabled: true,
      lockAvailable: false,
    });
    await cron.tick();
    expect(prisma.wallet.findMany).not.toHaveBeenCalled();
  });

  it('reports zero drift when ledger sums match', async () => {
    const { cron, events } = buildCron({
      enabled: true,
      walletBatches: [
        [
          { id: 'w-1', userId: 'u-1', balanceInPaise: 1000 },
          { id: 'w-2', userId: 'u-2', balanceInPaise: 0 },
        ],
        [], // sentinel empty batch — terminates the loop
      ],
      sumByWallet: { 'w-1': 1000, 'w-2': 0 },
    });
    const result = await cron.tick();
    expect(result.reconciled).toBe(2);
    expect(result.drifted).toBe(0);
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('emits wallet.ledger.drift_detected for each drifted wallet', async () => {
    const { cron, events } = buildCron({
      enabled: true,
      walletBatches: [
        [
          { id: 'w-clean', userId: 'u-1', balanceInPaise: 1000 },
          { id: 'w-drift', userId: 'u-2', balanceInPaise: 5000 },
        ],
        [],
      ],
      sumByWallet: { 'w-clean': 1000, 'w-drift': 4500 }, // 500 paise drift
    });
    const result = await cron.tick();
    expect(result.reconciled).toBe(2);
    expect(result.drifted).toBe(1);
    expect(events.publish).toHaveBeenCalledTimes(1);
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'wallet.ledger.drift_detected',
        aggregateId: 'w-drift',
        payload: expect.objectContaining({
          walletId: 'w-drift',
          balanceInPaise: 5000,
          ledgerSumInPaise: 4500,
          driftInPaise: 500,
        }),
      }),
    );
  });

  it('releases the lock on the happy path', async () => {
    const { cron, redis } = buildCron({
      enabled: true,
      walletBatches: [[]],
    });
    await cron.tick();
    expect(redis.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('releases the lock when scanning throws', async () => {
    const { cron, redis, prisma } = buildCron({ enabled: true });
    prisma.wallet.findMany.mockRejectedValue(new Error('db down'));
    await expect(cron.tick()).rejects.toThrow('db down');
    expect(redis.releaseLock).toHaveBeenCalledTimes(1);
  });
});
