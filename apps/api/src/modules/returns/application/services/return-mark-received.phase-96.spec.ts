// Phase 96 (2026-05-23) — Mark Received audit coverage.
//
// Gaps asserted:
//   #6 — same-state markReceived does NOT clobber receivedAt/By
//   #7 — same-state markReceived does NOT write duplicate
//        ReturnStatusHistory row
//   #8 — same-state markReceived does NOT re-publish event
//   #10 — non-same-state path wraps writes in $transaction
//   #14 — PICKUP_SCHEDULED → RECEIVED stamps bypassedInTransit=true

import { ReturnService } from './return.service';

function buildDeps(overrides: any = {}) {
  return {
    returnRepo: { findById: jest.fn() },
    prisma: {
      $transaction: jest.fn(),
      return: { findUnique: jest.fn() },
    },
    eligibilityService: {},
    autoApprovalService: {},
    stockRestorationService: {},
    commissionReversalService: {},
    refundGateway: {},
    cloudinaryAdapter: {},
    eventBus: { publish: jest.fn().mockResolvedValue(undefined) },
    caseDuplicates: {},
    env: {
      getOptional: () => undefined,
      getBoolean: () => false,
      getString: () => '',
      getNumber: () => 0,
    },
    restockingFee: {},
    abuseCounter: {},
    commissionFacade: {},
    logger: {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
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

function build(deps: any) {
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

describe('ReturnService.markReceived (Phase 96)', () => {
  it('Gap #6/#7/#8 — already-RECEIVED is a same-state no-op', async () => {
    const ret = {
      id: 'r1',
      status: 'RECEIVED',
      version: 1,
      returnNumber: 'RET-1',
      receivedAt: new Date('2026-05-20T10:00:00Z'),
      receivedBy: 'admin-orig',
    };
    const deps = buildDeps({
      returnRepo: { findById: jest.fn().mockResolvedValue(ret) },
    });
    const service = build(deps);
    const out = await service.markReceived('r1', 'ADMIN', 'admin-new', 'note');
    // Returned the ORIGINAL row, untouched
    expect(out).toBe(ret);
    expect(deps.prisma.$transaction).not.toHaveBeenCalled();
    expect(deps.eventBus.publish).not.toHaveBeenCalled();
    expect(deps.audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it('Gap #10 — first transition wraps writes in $transaction', async () => {
    const ret = {
      id: 'r1',
      status: 'IN_TRANSIT',
      version: 2,
      returnNumber: 'RET-1',
    };
    const tx: any = {
      return: {
        update: jest.fn().mockResolvedValue({ id: 'r1', status: 'RECEIVED' }),
      },
      returnStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const deps = buildDeps({
      returnRepo: { findById: jest.fn().mockResolvedValue(ret) },
      prisma: {
        $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
      },
    });
    const service = build(deps);
    await service.markReceived('r1', 'ADMIN', 'admin-1', 'arrived', 'OK');
    expect(deps.prisma.$transaction).toHaveBeenCalledTimes(1);
    const updateData = tx.return.update.mock.calls[0][0].data;
    expect(updateData.receivedByActorType).toBe('ADMIN');
    expect(updateData.parcelCondition).toBe('OK');
    expect(updateData.receivedBypassedInTransit).toBe(false);
    expect(updateData.qcStatus).toBe('PENDING_QC');
    expect(deps.eventBus.publish).toHaveBeenCalledTimes(1);
    expect(tx.returnStatusHistory.create).toHaveBeenCalledTimes(1);
  });

  it('Gap #14 — PICKUP_SCHEDULED → RECEIVED stamps bypassedInTransit=true', async () => {
    const ret = {
      id: 'r1',
      status: 'PICKUP_SCHEDULED',
      version: 0,
      returnNumber: 'RET-1',
    };
    const tx: any = {
      return: {
        update: jest.fn().mockResolvedValue({ id: 'r1', status: 'RECEIVED' }),
      },
      returnStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const deps = buildDeps({
      returnRepo: { findById: jest.fn().mockResolvedValue(ret) },
      prisma: {
        $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
      },
    });
    const service = build(deps);
    await service.markReceived('r1', 'ADMIN', 'admin-1', 'courier missed scan');
    const updateData = tx.return.update.mock.calls[0][0].data;
    expect(updateData.receivedBypassedInTransit).toBe(true);
  });

  it('P2025 race → BadRequest with refresh hint', async () => {
    const ret = { id: 'r1', status: 'IN_TRANSIT', version: 0, returnNumber: 'RET-1' };
    const tx: any = {
      return: {
        update: jest.fn().mockRejectedValue(
          Object.assign(new Error('Record not found'), { code: 'P2025' }),
        ),
      },
      returnStatusHistory: { create: jest.fn() },
    };
    const deps = buildDeps({
      returnRepo: { findById: jest.fn().mockResolvedValue(ret) },
      prisma: {
        $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
      },
    });
    const service = build(deps);
    await expect(
      service.markReceived('r1', 'ADMIN', 'admin-1'),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/refresh and retry/i),
    });
  });
});
