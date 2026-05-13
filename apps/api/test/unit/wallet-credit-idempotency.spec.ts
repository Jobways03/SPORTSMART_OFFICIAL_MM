import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { WalletService } from '../../src/modules/wallet/application/services/wallet.service';

/**
 * Phase 3 (PR 3.2) — wallet credit idempotency.
 *
 * The compound unique on (referenceType, referenceId, type) makes
 * second writes for the same reference reject at the DB level.
 * WalletService.credit must:
 *   - Short-circuit BEFORE applying the mutation when an existing tx
 *     for the reference is found (cheap path).
 *   - Recover from a parallel-write race where two callers both
 *     pass the pre-check but only one wins the unique index — the
 *     loser must look up and return the winner's row, not throw.
 *   - Pass through normally when no reference is provided (admin
 *     manual entries naturally have no idempotency context).
 */
describe('WalletService.credit — idempotency', () => {
  function buildService(opts: {
    existingByRef?: Record<string, unknown> | null;
    applyMutationResult?: Record<string, unknown>;
    raceOnApply?: boolean;
  }) {
    const repo = {
      getOrCreate: jest.fn().mockResolvedValue({
        id: 'w-1',
        userId: 'u-1',
        balanceInPaise: 0,
        version: 0,
        isBlocked: false,
        currency: 'INR',
      }),
      findTransactionByReference: jest
        .fn()
        .mockResolvedValue(opts.existingByRef ?? null),
      applyMutation: jest.fn().mockImplementation(async () => {
        if (opts.raceOnApply) {
          throw new Prisma.PrismaClientKnownRequestError(
            'unique constraint',
            { code: 'P2002', clientVersion: 'test' } as never,
          );
        }
        return (
          opts.applyMutationResult ?? {
            wallet: { id: 'w-1', balanceInPaise: 1000, version: 1 },
            transaction: { id: 'tx-new', referenceId: 'r-1' },
          }
        );
      }),
    };
    const eventBus = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const audit = {
      writeAuditLog: jest.fn().mockResolvedValue(undefined),
    };
    const razorpay = {} as never;
    // Phase 0 (PR 0.2) — paymentOpsFacade for the verifyTopup mismatch alert.
    // Credit tests don't exercise verifyTopup, so a noop is sufficient.
    const paymentOps = {
      flagMismatch: jest.fn().mockResolvedValue(undefined),
      recordAttempt: jest.fn().mockResolvedValue(undefined),
    };

    const service = new WalletService(
      repo as never,
      eventBus as never,
      audit as never,
      razorpay,
      paymentOps as never,
    );
    return { service, repo, eventBus };
  }

  it('returns the existing transaction without calling applyMutation', async () => {
    const existing = {
      id: 'tx-existing',
      walletId: 'w-1',
      referenceType: 'refund',
      referenceId: 'r-1',
      type: 'REFUND',
      amountInPaise: 1000,
    };
    const { service, repo } = buildService({ existingByRef: existing });

    const result = await service.credit({
      userId: 'u-1',
      amountInPaise: 1000,
      description: 'refund',
      type: 'REFUND',
      referenceType: 'refund',
      referenceId: 'r-1',
    });

    expect(result.transaction).toBe(existing);
    expect(repo.findTransactionByReference).toHaveBeenCalledWith({
      referenceType: 'refund',
      referenceId: 'r-1',
      type: 'REFUND',
    });
    // applyMutation MUST NOT run — the whole point of the fast-path.
    expect(repo.applyMutation).not.toHaveBeenCalled();
  });

  it('recovers from a race: P2002 on apply → return the winner row', async () => {
    const winner = {
      id: 'tx-winner',
      walletId: 'w-1',
      referenceType: 'refund',
      referenceId: 'r-1',
      type: 'REFUND',
      amountInPaise: 1000,
    };
    const { service, repo } = buildService({
      existingByRef: null, // first lookup misses
      raceOnApply: true,
    });
    // Second lookup (after the P2002) returns the winner.
    repo.findTransactionByReference
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);

    const result = await service.credit({
      userId: 'u-1',
      amountInPaise: 1000,
      description: 'refund',
      type: 'REFUND',
      referenceType: 'refund',
      referenceId: 'r-1',
    });

    expect(result.transaction).toBe(winner);
    expect(repo.applyMutation).toHaveBeenCalledTimes(1);
  });

  it('runs the normal credit when no existing reference + no race', async () => {
    const { service, repo } = buildService({});
    const result = await service.credit({
      userId: 'u-1',
      amountInPaise: 1000,
      description: 'refund',
      type: 'REFUND',
      referenceType: 'refund',
      referenceId: 'r-1',
    });
    expect(result.transaction.id).toBe('tx-new');
    expect(repo.applyMutation).toHaveBeenCalledTimes(1);
  });

  it('skips the dedup lookup when no reference is supplied', async () => {
    // Admin manual credit/debit — no referenceType/Id; the unique index
    // is naturally a no-op (NULLs distinct).
    const { service, repo } = buildService({});
    await service.credit({
      userId: 'u-1',
      amountInPaise: 500,
      description: 'manual top-up',
      type: 'CREDIT_ADJUSTMENT',
    });
    expect(repo.findTransactionByReference).not.toHaveBeenCalled();
    expect(repo.applyMutation).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-P2002 errors from applyMutation', async () => {
    const { service, repo } = buildService({});
    repo.applyMutation.mockRejectedValue(new Error('boom'));
    await expect(
      service.credit({
        userId: 'u-1',
        amountInPaise: 1000,
        description: 'refund',
        type: 'REFUND',
        referenceType: 'refund',
        referenceId: 'r-1',
      }),
    ).rejects.toThrow('boom');
  });
});
