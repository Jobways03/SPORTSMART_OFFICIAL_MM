// Phase 95 (2026-05-23) — coverage for Phase 93 + 94 deferred closures.
//
// Targets:
//   • Phase 94 deferred #20 — per-item rollup at respondAsSeller
//   • Phase 94 deferred #25 — rescindSellerResponse
//   • Phase 94 deferred #28 — extendSellerResponseWindow
//   • Phase 94 deferred #21 — QC contest override audit
//   • Structured contestReasonCategory persisted

import { ReturnService } from './return.service';

function buildBaseDeps(overrides: any = {}) {
  return {
    returnRepo: { findByIdWithItems: jest.fn() },
    prisma: { $transaction: jest.fn() },
    eligibilityService: {},
    autoApprovalService: {},
    stockRestorationService: {},
    commissionReversalService: {},
    refundGateway: {},
    cloudinaryAdapter: {},
    eventBus: { publish: jest.fn().mockResolvedValue(undefined) },
    caseDuplicates: {},
    env: { getOptional: () => undefined, getBoolean: () => false, getString: () => '' },
    restockingFee: {},
    abuseCounter: {},
    commissionFacade: {},
    logger: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    liabilityLedger: {},
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

function makeService(deps: any) {
  return new ReturnService(
    deps.returnRepo,
    deps.prisma,
    deps.eligibilityService,
    deps.autoApprovalService,
    deps.stockRestorationService,
    deps.commissionReversalService,
    deps.refundGateway,
    deps.cloudinaryAdapter,
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

function buildTx({ ret, items = [{ id: 'ri-1' }, { id: 'ri-2' }] }: any) {
  return {
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    return: {
      findUnique: jest.fn().mockResolvedValue(ret),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => ({
        id: where.id,
        ...data,
      })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    returnItem: {
      findMany: jest.fn().mockResolvedValue(items),
      update: jest.fn().mockResolvedValue({}),
    },
    returnEvidence: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    returnStatusHistory: {
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe('respondAsSeller (Phase 95 deferred #20 — per-item rollup)', () => {
  it('item-level CONTESTED rolls up to top-level CONTESTED', async () => {
    const ret = {
      id: 'r1',
      version: 0,
      status: 'REQUESTED',
      returnNumber: 'RET-1',
      sellerResponseStatus: 'PENDING',
      sellerResponseDueAt: new Date(Date.now() + 60_000),
      subOrder: { sellerId: 's-1' },
    };
    const tx = buildTx({ ret });
    const deps = buildBaseDeps({
      prisma: { $transaction: jest.fn().mockImplementation((fn) => fn(tx)) },
    });
    const service = makeService(deps);
    await service.respondAsSeller({
      returnId: 'r1',
      sellerId: 's-1',
      decision: 'ACCEPTED',
      itemDecisions: [
        { returnItemId: 'ri-1', decision: 'ACCEPTED' },
        { returnItemId: 'ri-2', decision: 'CONTESTED', note: 'item-2 not ours' },
      ],
    });
    const updated = tx.return.update.mock.calls[0][0].data;
    expect(updated.sellerResponseStatus).toBe('CONTESTED');
    // Each item should be updated individually.
    expect(tx.returnItem.update).toHaveBeenCalledTimes(2);
  });

  it('all-accepted items roll up to top-level ACCEPTED', async () => {
    const ret = {
      id: 'r1',
      version: 0,
      status: 'REQUESTED',
      returnNumber: 'RET-1',
      sellerResponseStatus: 'PENDING',
      sellerResponseDueAt: new Date(Date.now() + 60_000),
      subOrder: { sellerId: 's-1' },
    };
    const tx = buildTx({ ret });
    const deps = buildBaseDeps({
      prisma: { $transaction: jest.fn().mockImplementation((fn) => fn(tx)) },
    });
    const service = makeService(deps);
    await service.respondAsSeller({
      returnId: 'r1',
      sellerId: 's-1',
      decision: 'CONTESTED', // top-level overridden by items
      itemDecisions: [
        { returnItemId: 'ri-1', decision: 'ACCEPTED' },
        { returnItemId: 'ri-2', decision: 'ACCEPTED' },
      ],
    });
    const updated = tx.return.update.mock.calls[0][0].data;
    expect(updated.sellerResponseStatus).toBe('ACCEPTED');
  });

  it('rejects itemDecisions with foreign returnItemId', async () => {
    const ret = {
      id: 'r1',
      version: 0,
      status: 'REQUESTED',
      returnNumber: 'RET-1',
      sellerResponseStatus: 'PENDING',
      sellerResponseDueAt: new Date(Date.now() + 60_000),
      subOrder: { sellerId: 's-1' },
    };
    const tx = buildTx({ ret, items: [{ id: 'ri-1' }] });
    const deps = buildBaseDeps({
      prisma: { $transaction: jest.fn().mockImplementation((fn) => fn(tx)) },
    });
    const service = makeService(deps);
    await expect(
      service.respondAsSeller({
        returnId: 'r1',
        sellerId: 's-1',
        decision: 'ACCEPTED',
        itemDecisions: [
          { returnItemId: 'ri-1', decision: 'ACCEPTED' },
          { returnItemId: 'foreign', decision: 'CONTESTED' },
        ],
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/does not belong to this return/),
    });
  });

  it('persists contestReasonCategory on CONTESTED', async () => {
    const ret = {
      id: 'r1',
      version: 0,
      status: 'REQUESTED',
      returnNumber: 'RET-1',
      sellerResponseStatus: 'PENDING',
      sellerResponseDueAt: new Date(Date.now() + 60_000),
      subOrder: { sellerId: 's-1' },
    };
    const tx = buildTx({ ret });
    const deps = buildBaseDeps({
      prisma: { $transaction: jest.fn().mockImplementation((fn) => fn(tx)) },
    });
    const service = makeService(deps);
    await service.respondAsSeller({
      returnId: 'r1',
      sellerId: 's-1',
      decision: 'CONTESTED',
      notes: 'see attached',
      contestReasonCategory: 'OUT_OF_RETURN_WINDOW',
    });
    const updated = tx.return.update.mock.calls[0][0].data;
    expect(updated.sellerContestReasonCategory).toBe('OUT_OF_RETURN_WINDOW');
  });
});

describe('rescindSellerResponse (Phase 95 deferred #25)', () => {
  it('flips ACCEPTED → CONTESTED + publishes rescinded event', async () => {
    const ret = {
      id: 'r1',
      version: 1,
      status: 'REQUESTED',
      returnNumber: 'RET-1',
      sellerResponseStatus: 'ACCEPTED',
      sellerResponseDueAt: new Date(Date.now() + 60_000),
      subOrder: { sellerId: 's-1' },
    };
    const tx = buildTx({ ret });
    const publish = jest.fn().mockResolvedValue(undefined);
    const deps = buildBaseDeps({
      prisma: { $transaction: jest.fn().mockImplementation((fn) => fn(tx)) },
      eventBus: { publish },
    });
    const service = makeService(deps);
    await service.rescindSellerResponse({
      returnId: 'r1',
      sellerId: 's-1',
      newDecision: 'CONTESTED',
      notes: 'wait, this is not ours',
    });
    const updated = tx.return.update.mock.calls[0][0].data;
    expect(updated.sellerResponseStatus).toBe('CONTESTED');
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'returns.seller.response.rescinded' }),
      { tx },
    );
  });

  it('rejects rescind with same decision', async () => {
    const ret = {
      id: 'r1',
      version: 1,
      status: 'REQUESTED',
      returnNumber: 'RET-1',
      sellerResponseStatus: 'ACCEPTED',
      sellerResponseDueAt: new Date(Date.now() + 60_000),
      subOrder: { sellerId: 's-1' },
    };
    const tx = buildTx({ ret });
    const deps = buildBaseDeps({
      prisma: { $transaction: jest.fn().mockImplementation((fn) => fn(tx)) },
    });
    const service = makeService(deps);
    await expect(
      service.rescindSellerResponse({
        returnId: 'r1',
        sellerId: 's-1',
        newDecision: 'ACCEPTED',
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Already ACCEPTED/),
    });
  });

  it('rejects rescind when sellerResponseStatus is PENDING', async () => {
    const ret = {
      id: 'r1',
      version: 1,
      status: 'REQUESTED',
      returnNumber: 'RET-1',
      sellerResponseStatus: 'PENDING',
      sellerResponseDueAt: new Date(Date.now() + 60_000),
      subOrder: { sellerId: 's-1' },
    };
    const tx = buildTx({ ret });
    const deps = buildBaseDeps({
      prisma: { $transaction: jest.fn().mockImplementation((fn) => fn(tx)) },
    });
    const service = makeService(deps);
    await expect(
      service.rescindSellerResponse({
        returnId: 'r1',
        sellerId: 's-1',
        newDecision: 'CONTESTED',
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/requires a prior ACCEPTED or CONTESTED/),
    });
  });
});

describe('extendSellerResponseWindow (Phase 95 deferred #28)', () => {
  it('bumps dueAt + records audit pointer', async () => {
    const originalDue = new Date(Date.now() + 30_000);
    const ret = {
      id: 'r1',
      version: 0,
      status: 'REQUESTED',
      returnNumber: 'RET-1',
      sellerResponseStatus: 'PENDING',
      sellerResponseDueAt: originalDue,
      sellerResponseExtensionHours: null,
    };
    const tx = buildTx({ ret });
    const publish = jest.fn().mockResolvedValue(undefined);
    const deps = buildBaseDeps({
      prisma: { $transaction: jest.fn().mockImplementation((fn) => fn(tx)) },
      eventBus: { publish },
    });
    const service = makeService(deps);
    await service.extendSellerResponseWindow({
      returnId: 'r1',
      adminId: 'admin-1',
      additionalHours: 24,
      reason: 'seller out of office',
    });
    const updated = tx.return.update.mock.calls[0][0].data;
    expect(updated.sellerResponseExtendedBy).toBe('admin-1');
    expect(updated.sellerResponseExtensionHours).toBe(24);
    expect(new Date(updated.sellerResponseDueAt).getTime()).toBe(
      originalDue.getTime() + 24 * 60 * 60 * 1000,
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'returns.seller.response.extended' }),
      { tx },
    );
  });

  it('caps cumulative extension at 168h', async () => {
    const ret = {
      id: 'r1',
      version: 0,
      status: 'REQUESTED',
      returnNumber: 'RET-1',
      sellerResponseStatus: 'PENDING',
      sellerResponseDueAt: new Date(Date.now() + 60_000),
      sellerResponseExtensionHours: 150,
    };
    const tx = buildTx({ ret });
    const deps = buildBaseDeps({
      prisma: { $transaction: jest.fn().mockImplementation((fn) => fn(tx)) },
    });
    const service = makeService(deps);
    await expect(
      service.extendSellerResponseWindow({
        returnId: 'r1',
        adminId: 'admin-1',
        additionalHours: 24,
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/168h cap/),
    });
  });

  it('rejects extension when sellerResponseStatus is not PENDING', async () => {
    const ret = {
      id: 'r1',
      version: 0,
      status: 'REQUESTED',
      returnNumber: 'RET-1',
      sellerResponseStatus: 'ACCEPTED',
      sellerResponseDueAt: new Date(Date.now() + 60_000),
    };
    const tx = buildTx({ ret });
    const deps = buildBaseDeps({
      prisma: { $transaction: jest.fn().mockImplementation((fn) => fn(tx)) },
    });
    const service = makeService(deps);
    await expect(
      service.extendSellerResponseWindow({
        returnId: 'r1',
        adminId: 'admin-1',
        additionalHours: 12,
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/requires a PENDING response/),
    });
  });
});
