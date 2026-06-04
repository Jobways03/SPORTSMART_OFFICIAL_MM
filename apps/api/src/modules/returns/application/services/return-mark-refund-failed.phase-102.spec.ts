// Phase 101 (2026-05-23) — Phase 102 audit closure coverage.

import { ReturnService } from './return.service';

function buildDeps(overrides: any = {}) {
  return {
    returnRepo: {
      findById: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      recordStatusChange: jest.fn().mockResolvedValue({}),
    },
    prisma: { $transaction: jest.fn() },
    eligibilityService: {},
    autoApprovalService: {},
    stockRestorationService: {},
    commissionReversalService: {},
    refundGateway: {},
    media: {},
    eventBus: { publish: jest.fn().mockResolvedValue(undefined) },
    caseDuplicates: {},
    env: { getOptional: () => undefined, getBoolean: () => false, getString: () => '', getNumber: (_: string, def: number) => def },
    restockingFee: {},
    abuseCounter: {},
    commissionFacade: {},
    logger: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    liabilityLedger: { enqueueAdminTask: jest.fn().mockResolvedValue(undefined) },
    audit: { writeAuditLog: jest.fn().mockResolvedValue(undefined) },
    riskScorer: {},
    replacement: {},
    razorpay: {},
    discountAlloc: {},
    moneyDualWrite: { applyPaise: (_: string, d: any) => d },
    creditNote: {},
    walletAdjust: {},
    ...overrides,
  };
}

function build(deps: any) {
  return new ReturnService(
    deps.returnRepo,
    deps.prisma,
    deps.eligibilityService,
    deps.autoApprovalService,
    deps.stockRestorationService,
    deps.commissionReversalService,
    deps.refundGateway,
    deps.media,
    deps.eventBus,
    deps.caseDuplicates,
    deps.env,
    deps.restockingFee,
    deps.abuseCounter,
    deps.commissionFacade,
    deps.logger,
    deps.liabilityLedger,
    deps.audit,
    deps.riskScorer,
    deps.replacement,
    deps.razorpay,
    deps.discountAlloc,
    deps.moneyDualWrite,
    deps.creditNote,
    deps.walletAdjust,
  );
}

describe('ReturnService.markRefundFailed (Phase 101 / Phase 102 audit)', () => {
  it('Gap #4/#5 — increments refundAttempts + writes RefundTransaction + nulls refundReference', async () => {
    const ret = {
      id: 'r1',
      returnNumber: 'RET-1',
      status: 'REFUND_PROCESSING',
      version: 1,
      refundAttempts: 0,
      refundAmount: 100,
      refundAmountInPaise: BigInt(10000),
    };
    const tx: any = {
      return: { update: jest.fn().mockResolvedValue({ ...ret, status: 'REFUND_PROCESSING' }) },
      refundTransaction: { create: jest.fn().mockResolvedValue({}) },
      returnStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      refundInstruction: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const deps = buildDeps({
      returnRepo: { ...buildDeps().returnRepo, findById: jest.fn().mockResolvedValue(ret) },
      prisma: { $transaction: jest.fn().mockImplementation((fn) => fn(tx)) },
    });
    const service = build(deps);
    await service.markRefundFailed('r1', 'ADMIN', 'admin-1', 'gateway rejected');
    const updateData = tx.return.update.mock.calls[0][0].data;
    expect(updateData.refundAttempts).toEqual({ increment: 1 });
    expect(updateData.refundReference).toBeNull();
    expect(updateData.refundFailedBy).toBe('admin-1');
    expect(updateData.refundFailedByActor).toBe('ADMIN');
    expect(tx.refundTransaction.create).toHaveBeenCalledTimes(1);
    expect(tx.refundTransaction.create.mock.calls[0][0].data.status).toBe('FAILED');
  });

  it('Gap #6 — mirrors FAILED on linked RefundInstruction', async () => {
    const ret = {
      id: 'r1',
      returnNumber: 'RET-1',
      status: 'REFUND_PROCESSING',
      version: 1,
      refundAttempts: 0,
      refundAmount: 100,
    };
    const tx: any = {
      return: { update: jest.fn().mockResolvedValue({}) },
      refundTransaction: { create: jest.fn().mockResolvedValue({}) },
      returnStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      refundInstruction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const deps = buildDeps({
      returnRepo: { ...buildDeps().returnRepo, findById: jest.fn().mockResolvedValue(ret) },
      prisma: { $transaction: jest.fn().mockImplementation((fn) => fn(tx)) },
    });
    const service = build(deps);
    await service.markRefundFailed('r1', 'ADMIN', 'admin-1', 'reason');
    expect(tx.refundInstruction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceType: 'RETURN',
          sourceId: 'r1',
        }),
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('Gap #2 — flips to REFUND_FAILED when cap reached', async () => {
    const ret = {
      id: 'r1',
      returnNumber: 'RET-1',
      status: 'REFUND_PROCESSING',
      version: 1,
      refundAttempts: 4, // 4 + 1 = 5 = cap
      refundAmount: 100,
      refundMaxRetries: null,
    };
    const tx: any = {
      return: { update: jest.fn().mockResolvedValue({}) },
      refundTransaction: { create: jest.fn().mockResolvedValue({}) },
      returnStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      refundInstruction: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const deps = buildDeps({
      returnRepo: { ...buildDeps().returnRepo, findById: jest.fn().mockResolvedValue(ret) },
      prisma: { $transaction: jest.fn().mockImplementation((fn) => fn(tx)) },
    });
    const service = build(deps);
    await service.markRefundFailed('r1', 'ADMIN', 'admin-1', 'cap reached now');
    const updateData = tx.return.update.mock.calls[0][0].data;
    expect(updateData.status).toBe('REFUND_FAILED');
  });

  it('Gap #12 — P2025 race surfaces as BadRequest', async () => {
    const ret = {
      id: 'r1',
      returnNumber: 'RET-1',
      status: 'REFUND_PROCESSING',
      version: 1,
      refundAttempts: 0,
      refundAmount: 100,
    };
    const tx: any = {
      return: {
        update: jest.fn().mockRejectedValue(
          Object.assign(new Error('not found'), { code: 'P2025' }),
        ),
      },
      refundTransaction: { create: jest.fn() },
      returnStatusHistory: { create: jest.fn() },
      refundInstruction: { updateMany: jest.fn() },
    };
    const deps = buildDeps({
      returnRepo: { ...buildDeps().returnRepo, findById: jest.fn().mockResolvedValue(ret) },
      prisma: { $transaction: jest.fn().mockImplementation((fn) => fn(tx)) },
    });
    const service = build(deps);
    await expect(
      service.markRefundFailed('r1', 'ADMIN', 'admin-1', 'reason'),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/refresh and retry/i),
    });
  });

  it('rejects non-REFUND_PROCESSING status', async () => {
    const ret = { id: 'r1', returnNumber: 'RET-1', status: 'REFUNDED', refundAttempts: 0 };
    const deps = buildDeps({
      returnRepo: { ...buildDeps().returnRepo, findById: jest.fn().mockResolvedValue(ret) },
    });
    const service = build(deps);
    await expect(
      service.markRefundFailed('r1', 'ADMIN', 'admin-1', 'reason'),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/must be REFUND_PROCESSING/),
    });
  });
});

describe('ReturnService.closeReturn (Phase 101 / Phase 103 audit)', () => {
  it('Gap #4 — already-COMPLETED is a no-op (closedAt NOT overwritten)', async () => {
    const original = new Date('2026-05-20T10:00:00Z');
    const ret = {
      id: 'r1',
      returnNumber: 'RET-1',
      status: 'COMPLETED',
      closedAt: original,
      closedBy: 'orig-admin',
    };
    const deps = buildDeps({
      returnRepo: {
        ...buildDeps().returnRepo,
        findById: jest.fn().mockResolvedValue(ret),
        updateWithVersion: jest.fn(),
      },
    });
    const service = build(deps);
    const out = await service.closeReturn('r1', 'ADMIN', 'new-admin', 'late close');
    expect(out).toBe(ret);
    expect(deps.returnRepo.updateWithVersion).not.toHaveBeenCalled();
    expect(deps.eventBus.publish).not.toHaveBeenCalled();
  });

  it('Gap #2/#3 — closedBy + closeReason persisted on first close', async () => {
    const ret = {
      id: 'r1',
      returnNumber: 'RET-1',
      status: 'REFUNDED',
      version: 0,
    };
    // Phase 105 — closeReturn now wraps writes in prisma.$transaction
    // (Phase 103 Gap #7), so we mock the tx update directly.
    const tx: any = {
      return: { update: jest.fn().mockResolvedValue({ id: 'r1', status: 'COMPLETED' }) },
      returnStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const deps = buildDeps({
      returnRepo: {
        ...buildDeps().returnRepo,
        findById: jest.fn().mockResolvedValue(ret),
      },
      prisma: {
        $transaction: jest.fn().mockImplementation((fn) => fn(tx)),
      },
    });
    const service = build(deps);
    await service.closeReturn('r1', 'ADMIN', 'admin-1', 'normal completion');
    const updateData = tx.return.update.mock.calls[0][0].data;
    expect(updateData.closedBy).toBe('admin-1');
    expect(updateData.closedByActorType).toBe('ADMIN');
    expect(updateData.closeReason).toBe('normal completion');
    expect(updateData.status).toBe('COMPLETED');
  });
});
