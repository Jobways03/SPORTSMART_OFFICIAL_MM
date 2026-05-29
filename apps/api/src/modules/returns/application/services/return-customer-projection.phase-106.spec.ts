// Phase 106 (2026-05-23) — Phase 102 audit Gap #14 coverage.
//
// Customer-facing endpoints must NOT return the raw refundFailureReason
// (gateway internals). We verify that listCustomerReturns + getReturnDetail
// strip the admin-only fields before responding.

import { ReturnService } from './return.service';

function buildDeps(overrides: any = {}) {
  return {
    returnRepo: {
      findByCustomerId: jest.fn(),
      findByIdWithItems: jest.fn(),
    },
    prisma: {
      taxDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      walletAdjustment: { findFirst: jest.fn().mockResolvedValue(null) },
    },
    eligibilityService: {},
    autoApprovalService: {},
    stockRestorationService: {},
    commissionReversalService: {},
    refundGateway: {},
    cloudinaryAdapter: {},
    eventBus: { publish: jest.fn() },
    caseDuplicates: {},
    env: { getOptional: () => undefined, getBoolean: () => false, getString: () => '', getNumber: (_: string, def: number) => def },
    restockingFee: {},
    abuseCounter: {},
    commissionFacade: {},
    logger: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    liabilityLedger: {},
    audit: { writeAuditLog: jest.fn() },
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

const SAMPLE_RAW_RETURN = {
  id: 'r1',
  returnNumber: 'RET-1',
  customerId: 'c1',
  status: 'REFUND_PROCESSING',
  refundAmount: 100,
  refundFailureReason: 'Razorpay: card declined CVV mismatch INTERNAL',
  refundFailureMessageCustomer:
    'We hit an issue processing your refund. Our team is on it.',
  qcInternalNotes: 'Item smelled — suspect customer abuse',
  qcRationale: 'Internal-only rationale',
  refundFailedBy: 'admin-orig',
  refundFailedByActor: 'ADMIN',
  refundFailedAt: new Date(),
  closedBy: 'admin-99',
  closedByActorType: 'ADMIN',
  refundFailureHistory: [{ attemptNumber: 1, reason: 'bank rejected' }],
  sellerResponseNotes: 'admin-only seller chat',
  sellerContestReasonCategory: 'INSUFFICIENT_EVIDENCE',
  riskScore: 75,
  riskFlags: ['HIGH_VALUE'],
  riskScoredAt: new Date(),
};

describe('listCustomerReturns (Phase 106)', () => {
  it('Phase 102 #14 — strips admin-only fields from customer projection', async () => {
    const deps = buildDeps({
      returnRepo: {
        findByCustomerId: jest.fn().mockResolvedValue({
          returns: [SAMPLE_RAW_RETURN],
          total: 1,
        }),
        findByIdWithItems: jest.fn(),
      },
    });
    const service = build(deps);
    const result = await service.listCustomerReturns('c1', {
      page: 1,
      limit: 10,
    } as any);
    const row = result.returns[0] as any;
    // Customer-safe message survives.
    expect(row.refundFailureMessageCustomer).toMatch(/Our team is on it/);
    // Raw reason / internal fields are gone.
    expect(row.refundFailureReason).toBeUndefined();
    expect(row.qcInternalNotes).toBeUndefined();
    expect(row.qcRationale).toBeUndefined();
    expect(row.refundFailedBy).toBeUndefined();
    expect(row.refundFailedAt).toBeUndefined();
    expect(row.refundFailureHistory).toBeUndefined();
    expect(row.sellerResponseNotes).toBeUndefined();
    expect(row.sellerContestReasonCategory).toBeUndefined();
    expect(row.riskScore).toBeUndefined();
    expect(row.riskFlags).toBeUndefined();
    // Customer-safe identifying fields survive.
    expect(row.id).toBe('r1');
    expect(row.returnNumber).toBe('RET-1');
    expect(row.status).toBe('REFUND_PROCESSING');
  });
});

describe('getReturnDetail (Phase 106)', () => {
  it('Phase 102 #14 — projection applied to detail response', async () => {
    const deps = buildDeps({
      returnRepo: {
        findByCustomerId: jest.fn(),
        findByIdWithItems: jest.fn().mockResolvedValue(SAMPLE_RAW_RETURN),
      },
    });
    const service = build(deps);
    const result = await service.getReturnDetail('r1', 'c1');
    expect((result as any).refundFailureReason).toBeUndefined();
    expect((result as any).qcInternalNotes).toBeUndefined();
    expect((result as any).refundFailureMessageCustomer).toMatch(
      /Our team is on it/,
    );
  });

  it('rejects wrong-customer access', async () => {
    const deps = buildDeps({
      returnRepo: {
        findByCustomerId: jest.fn(),
        findByIdWithItems: jest.fn().mockResolvedValue({
          ...SAMPLE_RAW_RETURN,
          customerId: 'other',
        }),
      },
    });
    const service = build(deps);
    await expect(
      service.getReturnDetail('r1', 'c1'),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/do not have access/i),
    });
  });
});
