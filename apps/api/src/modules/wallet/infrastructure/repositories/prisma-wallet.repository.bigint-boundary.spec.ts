import 'reflect-metadata';
import { PrismaWalletRepository } from './prisma-wallet.repository';

/**
 * Phase 2 (PR 2.2) — bigint↔number boundary marshalling.
 *
 * After the wallet money columns flipped from INTEGER to BIGINT, Prisma
 * surfaces them as `bigint` at runtime. Application code reasons in
 * `number`; the repo is the single conversion point. These tests pin
 * the contract:
 *
 *   - On READ: bigint values from Prisma get `Number()`-cast in the
 *     entity returned to callers.
 *   - On WRITE: number values from callers get `BigInt()`-cast in the
 *     data sent to Prisma.
 *
 * If a future refactor accidentally drops a cast (e.g. forgets to map
 * in a new repo method), one of these tests fails — long before a
 * 2^53-paise value silently corrupts ledger arithmetic.
 *
 * The Prisma client is mocked. Real DB behaviour is covered by the
 * existing integration tests; here we just verify the conversion calls
 * are made.
 */

function buildPrismaMock(opts: {
  upsertResult?: any;
  findUniqueResult?: any;
  createResult?: any;
} = {}) {
  return {
    wallet: {
      upsert: jest.fn().mockResolvedValue(
        opts.upsertResult ?? {
          id: 'w-1',
          userId: 'u-1',
          balanceInPaise: 100_000n, // bigint from Prisma
          currency: 'INR',
          version: 0,
          isBlocked: false,
          blockedReason: null,
          blockedAt: null,
          blockedByAdminId: null,
          createdAt: new Date('2026-05-01T00:00:00Z'),
          updatedAt: new Date('2026-05-12T00:00:00Z'),
        },
      ),
      findUnique: jest.fn().mockResolvedValue(opts.findUniqueResult ?? null),
    },
    walletTransaction: {
      create: jest.fn().mockResolvedValue(
        opts.createResult ?? {
          id: 't-1',
          walletId: 'w-1',
          userId: 'u-1',
          type: 'REFUND',
          status: 'PENDING',
          amountInPaise: 50_000n,
          balanceAfterInPaise: 100_000n,
          referenceType: 'RefundInstruction',
          referenceId: 'rin-1',
          description: 'test',
          internalNotes: null,
          createdByAdminId: null,
          createdAt: new Date('2026-05-12T00:00:00Z'),
        },
      ),
    },
  } as any;
}

describe('PrismaWalletRepository — bigint↔number marshalling (PR 2.2)', () => {
  describe('READ path — Number() conversion', () => {
    it('getOrCreate: bigint balanceInPaise from Prisma becomes number in the returned entity', async () => {
      const prisma = buildPrismaMock();
      const repo = new PrismaWalletRepository(prisma);

      const entity = await repo.getOrCreate('u-1');

      expect(typeof entity.balanceInPaise).toBe('number');
      expect(entity.balanceInPaise).toBe(100_000);
    });

    it('getOrCreate: seeds new wallets with BigInt(0), not Int(0)', async () => {
      // Prisma rejects `0` (number) for a BigInt column at runtime in
      // strict mode. Verify the repo passes `0n` so a fresh-wallet
      // upsert doesn't crash.
      const prisma = buildPrismaMock();
      const repo = new PrismaWalletRepository(prisma);

      await repo.getOrCreate('u-1');

      const upsertCall = prisma.wallet.upsert.mock.calls[0][0];
      expect(typeof upsertCall.create.balanceInPaise).toBe('bigint');
      expect(upsertCall.create.balanceInPaise).toBe(0n);
    });

    it('findByUserId: returns null cleanly when no row', async () => {
      const prisma = buildPrismaMock({ findUniqueResult: null });
      const repo = new PrismaWalletRepository(prisma);

      const result = await repo.findByUserId('u-1');
      expect(result).toBeNull();
    });

    it('findByUserId: maps bigint to number when a row exists', async () => {
      const prisma = buildPrismaMock({
        findUniqueResult: {
          id: 'w-2',
          userId: 'u-2',
          balanceInPaise: 2_147_483_648n, // exceeds INT max — proves we're not narrowing
          currency: 'INR',
          version: 3,
          isBlocked: false,
          blockedReason: null,
          blockedAt: null,
          blockedByAdminId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const repo = new PrismaWalletRepository(prisma);

      const entity = await repo.findByUserId('u-2');
      expect(entity).not.toBeNull();
      expect(typeof entity!.balanceInPaise).toBe('number');
      // 2^31 = 2,147,483,648 — one past old INT max. number can hold this.
      expect(entity!.balanceInPaise).toBe(2_147_483_648);
    });

    it('findTransactionById: maps amountInPaise + balanceAfterInPaise to number', async () => {
      const prisma = buildPrismaMock();
      prisma.walletTransaction.findUnique = jest.fn().mockResolvedValue({
        id: 't-1',
        walletId: 'w-1',
        userId: 'u-1',
        type: 'REFUND',
        status: 'COMPLETED',
        amountInPaise: 75_000n,
        balanceAfterInPaise: 175_000n,
        referenceType: 'Return',
        referenceId: 'ret-1',
        description: 'refund',
        internalNotes: null,
        createdByAdminId: null,
        createdAt: new Date(),
      });
      const repo = new PrismaWalletRepository(prisma);

      const tx = await repo.findTransactionById('t-1');
      expect(tx).not.toBeNull();
      expect(typeof tx!.amountInPaise).toBe('number');
      expect(typeof tx!.balanceAfterInPaise).toBe('number');
      expect(tx!.amountInPaise).toBe(75_000);
      expect(tx!.balanceAfterInPaise).toBe(175_000);
    });
  });

  describe('WRITE path — BigInt() conversion', () => {
    it('insertPending: number amounts passed to Prisma become bigint in the create call', async () => {
      const prisma = buildPrismaMock();
      const repo = new PrismaWalletRepository(prisma);

      await repo.insertPending({
        walletId: 'w-1',
        userId: 'u-1',
        type: 'TOPUP',
        amountInPaise: 100_000,
        balanceAfterInPaise: 100_000,
        description: 'test top-up',
      });

      const createCall = prisma.walletTransaction.create.mock.calls[0][0];
      expect(typeof createCall.data.amountInPaise).toBe('bigint');
      expect(typeof createCall.data.balanceAfterInPaise).toBe('bigint');
      expect(createCall.data.amountInPaise).toBe(100_000n);
      expect(createCall.data.balanceAfterInPaise).toBe(100_000n);
    });

    it('insertPending: the returned entity is already number-typed (round-trip)', async () => {
      const prisma = buildPrismaMock();
      const repo = new PrismaWalletRepository(prisma);

      const tx = await repo.insertPending({
        walletId: 'w-1',
        userId: 'u-1',
        type: 'TOPUP',
        amountInPaise: 50_000,
        balanceAfterInPaise: 100_000,
        description: 'test',
      });
      expect(typeof tx.amountInPaise).toBe('number');
      expect(typeof tx.balanceAfterInPaise).toBe('number');
    });
  });
});
