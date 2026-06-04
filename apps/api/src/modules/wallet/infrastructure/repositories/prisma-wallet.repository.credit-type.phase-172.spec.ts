import { PrismaWalletRepository } from './prisma-wallet.repository';

/**
 * Phase 172 (Goodwill Credit audit #8/#9) — repository persistence boundary.
 *
 * The adversarial review flagged that creditType/expiresAt were dropped before
 * the DB. This drives the REAL repository against a mocked prisma client and
 * asserts that applyMutation forwards both onto `walletTransaction.create`'s
 * data — i.e. a goodwill credit is actually written with creditType=GOODWILL +
 * an expiry, not silently NULL.
 */
describe('PrismaWalletRepository — Phase 172 creditType/expiresAt persistence', () => {
  let prisma: any;
  let txClient: any;
  let repo: PrismaWalletRepository;

  beforeEach(() => {
    const walletRow = {
      id: 'w1',
      userId: 'u1',
      balanceInPaise: BigInt(75000),
      currency: 'INR',
      version: 1,
      isBlocked: false,
      blockedReason: null,
      blockedAt: null,
      blockedByAdminId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    txClient = {
      wallet: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(walletRow),
      },
      walletTransaction: {
        create: jest.fn().mockImplementation(({ data }: any) => ({
          ...data,
          id: 'tx1',
          status: data.status ?? 'COMPLETED',
          createdAt: new Date(),
        })),
      },
    };
    prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(async (cb: any) => cb(txClient)),
    };
    repo = new PrismaWalletRepository(prisma);
  });

  it('writes creditType + expiresAt onto the ledger row for a goodwill credit', async () => {
    const expiresAt = new Date('2026-12-01T00:00:00.000Z');
    await repo.applyMutation({
      walletId: 'w1',
      expectedVersion: 1,
      newBalanceInPaise: 75000,
      transaction: {
        walletId: 'w1',
        userId: 'u1',
        type: 'REFUND' as any,
        amountInPaise: 75000,
        balanceAfterInPaise: 75000,
        referenceType: 'refund',
        referenceId: 'rin-1',
        description: 'Dispute DSP-1 — ₹750.00 goodwill credit (with our apologies)',
        creditType: 'GOODWILL' as any,
        expiresAt,
      },
    });
    expect(txClient.walletTransaction.create).toHaveBeenCalledTimes(1);
    const data = txClient.walletTransaction.create.mock.calls[0][0].data;
    expect(data.creditType).toBe('GOODWILL');
    expect(data.expiresAt).toBe(expiresAt);
  });

  it('persists null creditType/expiresAt for a plain refund (no goodwill tagging)', async () => {
    await repo.applyMutation({
      walletId: 'w1',
      expectedVersion: 1,
      newBalanceInPaise: 5000,
      transaction: {
        walletId: 'w1',
        userId: 'u1',
        type: 'REFUND' as any,
        amountInPaise: 5000,
        balanceAfterInPaise: 5000,
        referenceType: 'refund',
        referenceId: 'rin-2',
        description: 'Return RET-1 — ₹50.00 refunded to wallet',
      },
    });
    const data = txClient.walletTransaction.create.mock.calls[0][0].data;
    expect(data.creditType ?? null).toBeNull();
    expect(data.expiresAt ?? null).toBeNull();
  });
});
