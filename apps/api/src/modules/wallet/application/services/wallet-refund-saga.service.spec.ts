// Phase 70 (2026-05-22) — Phase 66 audit Gap #8. Wallet refund
// saga primitive.

import { WalletRefundSagaService } from './wallet-refund-saga.service';

function makeSvc(over: {
  existing?: any;
  creditThrows?: Error;
} = {}) {
  const findFirst = jest.fn().mockResolvedValue(over.existing ?? null);
  const findUnique = jest.fn();
  const create = jest.fn().mockImplementation(async ({ data }: any) => ({
    id: 'saga-1',
    ...data,
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    completedAt: null,
  }));
  const update = jest.fn().mockImplementation(async ({ data }: any) => data);
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma: any = {
    walletRefundSaga: { findFirst, findUnique, create, update, findMany },
  };
  const wallet: any = {
    credit: over.creditThrows
      ? jest.fn().mockRejectedValue(over.creditThrows)
      : jest.fn().mockResolvedValue({ ok: true }),
  };
  const svc = new WalletRefundSagaService(prisma, wallet);
  return { svc, prisma, wallet, findFirst, findUnique, create, update };
}

describe('WalletRefundSagaService.enqueueAndAttempt', () => {
  it('writes a PENDING row, runs the credit, marks COMPLETED on success', async () => {
    const { svc, create, update, wallet } = makeSvc();
    // findUnique returns the row we just created
    (svc as any).prisma.walletRefundSaga.findUnique.mockResolvedValue({
      id: 'saga-1',
      customerId: 'c-1',
      orderId: 'mo-1',
      amountInPaise: 5000n,
      reason: 'razorpay failed',
      status: 'PENDING',
      attempts: 0,
    });
    const result = await svc.enqueueAndAttempt({
      customerId: 'c-1',
      orderId: 'mo-1',
      amountInPaise: 5000n,
      reason: 'razorpay failed',
    });
    expect(create).toHaveBeenCalled();
    expect(wallet.credit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'c-1',
        amountInPaise: 5000,
        type: 'CREDIT_ADJUSTMENT',
        referenceType: 'order_cancellation',
        referenceId: 'mo-1',
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'saga-1' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          completedAt: expect.any(Date),
          attempts: { increment: 1 },
        }),
      }),
    );
    expect(result.status).toBe('COMPLETED');
  });

  it('flips to FAILED + increments attempts when credit throws', async () => {
    const { svc, update } = makeSvc({
      creditThrows: new Error('wallet locked'),
    });
    (svc as any).prisma.walletRefundSaga.findUnique.mockResolvedValue({
      id: 'saga-2',
      customerId: 'c-1',
      orderId: 'mo-1',
      amountInPaise: 5000n,
      reason: 'razorpay failed',
      status: 'PENDING',
      attempts: 0,
    });
    const result = await svc.enqueueAndAttempt({
      customerId: 'c-1',
      orderId: 'mo-1',
      amountInPaise: 5000n,
      reason: 'razorpay failed',
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          attempts: 1,
          lastError: 'wallet locked',
        }),
      }),
    );
    expect(result.status).toBe('FAILED');
  });

  it('flips to ABANDONED after MAX_ATTEMPTS', async () => {
    const { svc, update } = makeSvc({
      creditThrows: new Error('permanent block'),
    });
    (svc as any).prisma.walletRefundSaga.findUnique.mockResolvedValue({
      id: 'saga-3',
      customerId: 'c-1',
      orderId: 'mo-1',
      amountInPaise: 5000n,
      reason: 'razorpay failed',
      status: 'FAILED',
      attempts: 4, // one more attempt will reach MAX (5)
    });
    await svc.enqueueAndAttempt({
      customerId: 'c-1',
      orderId: 'mo-1',
      amountInPaise: 5000n,
      reason: 'razorpay failed',
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ABANDONED',
          attempts: 5,
        }),
      }),
    );
  });

  it('reuses an existing non-COMPLETED row instead of inserting a duplicate', async () => {
    const { svc, create } = makeSvc({
      existing: {
        id: 'saga-existing',
        customerId: 'c-1',
        orderId: 'mo-1',
        amountInPaise: 5000n,
        reason: 'razorpay failed',
        status: 'FAILED',
        attempts: 1,
      },
    });
    (svc as any).prisma.walletRefundSaga.findUnique.mockResolvedValue({
      id: 'saga-existing',
      customerId: 'c-1',
      orderId: 'mo-1',
      amountInPaise: 5000n,
      reason: 'razorpay failed',
      status: 'FAILED',
      attempts: 1,
    });
    await svc.enqueueAndAttempt({
      customerId: 'c-1',
      orderId: 'mo-1',
      amountInPaise: 5000n,
      reason: 'razorpay failed',
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('WalletRefundSagaService.attempt — idempotent', () => {
  it('returns COMPLETED without re-charging when already COMPLETED', async () => {
    const { svc, wallet } = makeSvc();
    (svc as any).prisma.walletRefundSaga.findUnique.mockResolvedValue({
      id: 'saga-done',
      customerId: 'c-1',
      orderId: 'mo-1',
      amountInPaise: 5000n,
      reason: 'x',
      status: 'COMPLETED',
      attempts: 1,
    });
    const result = await svc.attempt('saga-done');
    expect(result.status).toBe('COMPLETED');
    expect(wallet.credit).not.toHaveBeenCalled();
  });

  it('returns FAILED without re-charging when ABANDONED', async () => {
    const { svc, wallet } = makeSvc();
    (svc as any).prisma.walletRefundSaga.findUnique.mockResolvedValue({
      id: 'saga-aban',
      customerId: 'c-1',
      orderId: 'mo-1',
      amountInPaise: 5000n,
      reason: 'x',
      status: 'ABANDONED',
      attempts: 5,
    });
    const result = await svc.attempt('saga-aban');
    expect(result.status).toBe('FAILED');
    expect(wallet.credit).not.toHaveBeenCalled();
  });
});
