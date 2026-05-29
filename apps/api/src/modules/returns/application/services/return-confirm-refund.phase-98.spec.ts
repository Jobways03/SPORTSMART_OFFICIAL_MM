// Phase 96 (2026-05-23) — Phase 98 audit Gap #9 / #29 coverage.

import { ReturnService } from './return.service';

function buildDeps(overrides: any = {}) {
  return {
    returnRepo: {
      findById: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'r1', status: 'REFUNDED' }),
      recordStatusChange: jest.fn().mockResolvedValue({}),
    },
    prisma: { return: { findFirst: jest.fn().mockResolvedValue(null) } },
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

describe('ReturnService.confirmRefund (Phase 96 / Phase 98 audit)', () => {
  const ret = {
    id: 'r1',
    status: 'REFUND_PROCESSING',
    returnNumber: 'RET-1',
    refundAmount: 100,
  };

  it('Gap #9 — blank refundReference rejected', async () => {
    const deps = buildDeps({
      returnRepo: { ...buildDeps().returnRepo, findById: jest.fn().mockResolvedValue(ret) },
    });
    const service = build(deps);
    await expect(
      service.confirmRefund('r1', 'ADMIN', 'admin-1', {
        refundReference: '   ',
        refundMethod: 'WALLET',
      } as any),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/required and cannot be blank/),
    });
  });

  it('Gap #9 — overly long refundReference rejected (>256)', async () => {
    const deps = buildDeps({
      returnRepo: { ...buildDeps().returnRepo, findById: jest.fn().mockResolvedValue(ret) },
    });
    const service = build(deps);
    await expect(
      service.confirmRefund('r1', 'ADMIN', 'admin-1', {
        refundReference: 'x'.repeat(300),
      } as any),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/too long/i),
    });
  });

  it('Gap #29 — duplicate refundReference across returns rejected', async () => {
    const deps = buildDeps({
      returnRepo: { ...buildDeps().returnRepo, findById: jest.fn().mockResolvedValue(ret) },
      prisma: {
        return: {
          findFirst: jest.fn().mockResolvedValue({ id: 'r2', returnNumber: 'RET-2' }),
        },
      },
    });
    const service = build(deps);
    await expect(
      service.confirmRefund('r1', 'ADMIN', 'admin-1', {
        refundReference: 'rfnd_abc123',
      } as any),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/already in use by return RET-2/),
    });
  });

  it('happy path — refundReference unique, flips to REFUNDED', async () => {
    const deps = buildDeps({
      returnRepo: { ...buildDeps().returnRepo, findById: jest.fn().mockResolvedValue(ret) },
    });
    const service = build(deps);
    const updated = await service.confirmRefund('r1', 'ADMIN', 'admin-1', {
      refundReference: '  rfnd_abc123  ',
    } as any);
    // Trimmed reference passed through to the update.
    const updateData = deps.returnRepo.update.mock.calls[0][1];
    expect(updateData.refundReference).toBe('rfnd_abc123');
    expect(updateData.status).toBe('REFUNDED');
    expect(updated).toBeTruthy();
  });
});
