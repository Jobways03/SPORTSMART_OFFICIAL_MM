import { Prisma } from '@prisma/client';
import { WalletService } from './wallet.service';
import {
  WalletEntity,
  WalletTransactionEntity,
  WalletRepository,
} from '../../domain/repositories/wallet.repository.interface';

/**
 * Phase 13 — wallet idempotency unit tests.
 *
 * Concern: a refund saga can replay (cron retry, queue redelivery,
 * RefundInstruction processed twice). The wallet must NEVER credit
 * the customer twice for the same logical event. The DB-level UNIQUE
 * (referenceType, referenceId, type) is the source of truth; this
 * test covers the service-layer protection — the fast-path lookup +
 * the P2002-recovery branch — both of which short-circuit a duplicate
 * write before it produces a second wallet_transactions row.
 */
describe('WalletService — credit idempotency', () => {
  const userId = 'cust-1';
  const wallet: WalletEntity = {
    id: 'wallet-1',
    userId,
    balanceInPaise: 0,
    currency: 'INR',
    isBlocked: false,
    blockedReason: null,
    blockedAt: null,
    blockedByAdminId: null,
    version: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const existingTx: WalletTransactionEntity = {
    id: 'tx-existing',
    walletId: wallet.id,
    userId,
    type: 'REFUND' as any,
    status: 'COMPLETED' as any,
    amountInPaise: 50000,
    balanceAfterInPaise: 50000,
    balanceBeforeInPaise: 0,
    direction: 'CREDIT' as any,
    currency: 'INR',
    referenceNumber: null,
    referenceType: 'RefundInstruction',
    referenceId: 'rin-1',
    description: 'Return RET-2026-000001 — wallet refund',
    reason: null,
    internalNotes: null,
    createdByAdminId: null,
    // Phase 172 (#8/#9) — now-required ledger columns.
    creditType: null,
    expiresAt: null,
    lapsedAt: null,
    createdAt: new Date(),
  };

  function buildService(repoOverrides: Partial<WalletRepository>): WalletService {
    const baseRepo: WalletRepository = {
      findByUserId: jest.fn().mockResolvedValue(wallet),
      getOrCreate: jest.fn().mockResolvedValue(wallet),
      listTransactions: jest.fn(),
      findTransactionByReference: jest.fn().mockResolvedValue(null),
      applyMutation: jest.fn().mockResolvedValue({ wallet, transaction: existingTx }),
      // Methods we don't exercise — stub as jest.fn() to satisfy the
      // interface shape without runtime calls.
      blockWallet: jest.fn(),
      unblockWallet: jest.fn(),
    } as unknown as WalletRepository;
    const repo: WalletRepository = { ...baseRepo, ...repoOverrides } as WalletRepository;
    const noopEventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
    const noopAudit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
    const noopRazorpay = {} as any;
    // Phase 0 (PR 0.2) — facade injected purely for the verifyTopup amount
    // check. Credit/debit tests don't exercise it; noop is fine.
    const noopPaymentOps = {
      flagMismatch: jest.fn().mockResolvedValue(undefined),
      recordAttempt: jest.fn().mockResolvedValue(undefined),
    } as any;
    return new WalletService(repo, noopRazorpay, noopEventBus, noopAudit, noopPaymentOps);
  }

  describe('fast path — duplicate detected before mutation', () => {
    it('returns the existing transaction when (referenceType, referenceId, type) already exists', async () => {
      const findExisting = jest.fn().mockResolvedValue(existingTx);
      const applyMutation = jest.fn();
      const service = buildService({
        findTransactionByReference: findExisting,
        applyMutation,
      });

      const result = await service.credit({
        userId,
        amountInPaise: 50000,
        description: 'Return RET-2026-000001 — wallet refund',
        type: 'REFUND',
        referenceType: 'RefundInstruction',
        referenceId: 'rin-1',
      });

      expect(findExisting).toHaveBeenCalledWith({
        referenceType: 'RefundInstruction',
        referenceId: 'rin-1',
        type: 'REFUND',
      });
      // applyMutation must NOT be called — that's the whole point of
      // idempotency: no second row, no second balance change.
      expect(applyMutation).not.toHaveBeenCalled();
      expect(result.transaction.id).toBe(existingTx.id);
    });
  });

  describe('race path — two callers race past the fast-path check', () => {
    it('catches P2002 from the unique index and returns the winning row', async () => {
      // The fast-path lookup returns null (no existing row visible at
      // read time), then the apply-mutation throws P2002 because a
      // parallel writer just claimed the same (referenceType, referenceId,
      // type). The service must catch P2002 and re-fetch the winner.
      const findExisting = jest
        .fn()
        // first call (fast path) — no row yet
        .mockResolvedValueOnce(null)
        // second call (P2002 recovery) — row now exists
        .mockResolvedValueOnce(existingTx);

      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`referenceType`,`referenceId`,`type`)',
        { code: 'P2002', clientVersion: 'test' },
      );
      const applyMutation = jest.fn().mockRejectedValue(p2002);

      const service = buildService({
        findTransactionByReference: findExisting,
        applyMutation,
      });

      const result = await service.credit({
        userId,
        amountInPaise: 50000,
        description: 'duplicate refund',
        type: 'REFUND',
        referenceType: 'RefundInstruction',
        referenceId: 'rin-1',
      });

      expect(applyMutation).toHaveBeenCalledTimes(1);
      expect(findExisting).toHaveBeenCalledTimes(2);
      expect(result.transaction.id).toBe(existingTx.id);
    });
  });
});
