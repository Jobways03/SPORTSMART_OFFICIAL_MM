// Phase 70 (2026-05-22) — Phase 66 audit Gap #3/#10, Phase 67 audit
// Gap #4. Payment entity scaffolding.

import { PaymentLifecycleService } from './payment-lifecycle.service';

function makeSvc() {
  const findFirst = jest.fn().mockResolvedValue(null);
  const create = jest.fn().mockResolvedValue({});
  const upsert = jest.fn().mockResolvedValue({});
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma: any = {
    payment: { findFirst, create, upsert, updateMany },
  };
  const svc = new PaymentLifecycleService(prisma);
  return { svc, findFirst, create, upsert, updateMany };
}

describe('PaymentLifecycleService.recordCodPayment', () => {
  it('writes a PENDING COD row', async () => {
    const { svc, create } = makeSvc();
    await svc.recordCodPayment({ masterOrderId: 'mo-1', amountInPaise: 5000n });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          masterOrderId: 'mo-1',
          method: 'COD',
          status: 'PENDING',
          amountInPaise: 5000n,
        }),
      }),
    );
  });

  it('is idempotent — no double write on retry', async () => {
    const { svc, findFirst, create } = makeSvc();
    findFirst.mockResolvedValueOnce({ id: 'existing' });
    await svc.recordCodPayment({ masterOrderId: 'mo-1', amountInPaise: 5000n });
    expect(create).not.toHaveBeenCalled();
  });

  it('swallows errors (best-effort shadow write)', async () => {
    const { svc, create } = makeSvc();
    create.mockRejectedValueOnce(new Error('DB down'));
    await expect(
      svc.recordCodPayment({ masterOrderId: 'mo-1', amountInPaise: 5000n }),
    ).resolves.toBeUndefined();
  });
});

describe('PaymentLifecycleService.recordOnlinePaymentCreated', () => {
  it('upserts a CREATED row keyed on providerOrderId', async () => {
    const { svc, upsert } = makeSvc();
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    await svc.recordOnlinePaymentCreated({
      masterOrderId: 'mo-2',
      amountInPaise: 12000n,
      providerOrderId: 'order_xyz',
      idempotencyKey: 'sha256-abc',
      expiresAt,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerOrderId: 'order_xyz' },
        create: expect.objectContaining({
          method: 'ONLINE',
          status: 'CREATED',
          providerOrderId: 'order_xyz',
          idempotencyKey: 'sha256-abc',
          expiresAt,
        }),
      }),
    );
  });
});

describe('PaymentLifecycleService.recordWalletOnlyPayment', () => {
  it('writes a CAPTURED WALLET_ONLY row', async () => {
    const { svc, create } = makeSvc();
    await svc.recordWalletOnlyPayment({
      masterOrderId: 'mo-3',
      amountInPaise: 8000n,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          method: 'WALLET_ONLY',
          status: 'CAPTURED',
          amountInPaise: 8000n,
          capturedAt: expect.any(Date),
        }),
      }),
    );
  });
});

describe('PaymentLifecycleService.markCaptured', () => {
  it('flips status to CAPTURED on payments matching providerOrderId', async () => {
    const { svc, updateMany } = makeSvc();
    await svc.markCaptured({
      providerOrderId: 'order_z',
      providerPaymentId: 'pay_z',
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerOrderId: 'order_z' },
        data: expect.objectContaining({
          status: 'CAPTURED',
          providerPaymentId: 'pay_z',
          capturedAt: expect.any(Date),
        }),
      }),
    );
  });
});

describe('PaymentLifecycleService.markTerminal', () => {
  it('only flips non-terminal rows (CREATED, PENDING)', async () => {
    const { svc, updateMany } = makeSvc();
    await svc.markTerminal({ masterOrderId: 'mo-4', status: 'CANCELLED' });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          masterOrderId: 'mo-4',
          status: { in: ['CREATED', 'PENDING'] },
        }),
        data: expect.objectContaining({
          status: 'CANCELLED',
          terminalAt: expect.any(Date),
        }),
      }),
    );
  });
});
