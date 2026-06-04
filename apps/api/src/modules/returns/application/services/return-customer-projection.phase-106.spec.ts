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
      findByCustomerIdSafe: jest.fn(),
      findByIdWithItems: jest.fn(),
      findByIdForCustomer: jest.fn(),
    },
    prisma: {
      taxDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      walletAdjustment: { findFirst: jest.fn().mockResolvedValue(null) },
      dispute: { findFirst: jest.fn().mockResolvedValue(null) },
    },
    eligibilityService: {},
    autoApprovalService: {},
    stockRestorationService: {},
    commissionReversalService: {},
    refundGateway: {},
    media: {},
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

// Phase 199 (2026-06-02) — the customer projection moved from a
// service-layer blacklist to a repository strict-`select` whitelist
// (findByCustomerIdSafe / findByIdForCustomer). The safe repo methods
// physically never select the admin-only columns, so the SAFE sample
// below is what the strict select yields. The service must:
//   - route customer reads through the SAFE methods (NOT the full ones),
//   - keep the customer-safe refund mirror, and
//   - sanitize status-history notes for non-CUSTOMER/ADMIN actors.
const SAMPLE_SAFE_RETURN = {
  id: 'r1',
  returnNumber: 'RET-1',
  customerId: 'c1',
  status: 'REFUND_PROCESSING',
  refundAmount: 100,
  refundFailureMessageCustomer:
    'We hit an issue processing your refund. Our team is on it.',
};

describe('listCustomerReturns (Phase 106 / 199)', () => {
  it('routes through the customer-safe whitelist repo method, not the full include', async () => {
    const safe = jest
      .fn()
      .mockResolvedValue({ returns: [SAMPLE_SAFE_RETURN], total: 1 });
    const full = jest.fn();
    const deps = buildDeps({
      returnRepo: {
        findByCustomerId: full,
        findByCustomerIdSafe: safe,
        findByIdWithItems: jest.fn(),
        findByIdForCustomer: jest.fn(),
      },
    });
    const service = build(deps);
    const result = await service.listCustomerReturns('c1', {
      page: 1,
      limit: 10,
    } as any);
    // The leaky full-include method must NOT be used for customers.
    expect(full).not.toHaveBeenCalled();
    expect(safe).toHaveBeenCalledWith('c1', { page: 1, limit: 10 });
    const row = result.returns[0] as any;
    // Customer-safe message survives; admin-only fields are absent
    // (never selected by the safe repo method).
    expect(row.refundFailureMessageCustomer).toMatch(/Our team is on it/);
    expect(row.refundFailureReason).toBeUndefined();
    expect(row.qcInternalNotes).toBeUndefined();
    expect(row.riskScore).toBeUndefined();
    expect(row.id).toBe('r1');
    expect(row.returnNumber).toBe('RET-1');
    expect(row.status).toBe('REFUND_PROCESSING');
  });
});

describe('getReturnDetail (Phase 106 / 199)', () => {
  it('routes through findByIdForCustomer and never exposes admin-only fields', async () => {
    const safe = jest.fn().mockResolvedValue({
      ...SAMPLE_SAFE_RETURN,
      statusHistory: [],
      evidence: [],
      refundTransactions: [],
    });
    const full = jest.fn();
    const deps = buildDeps({
      returnRepo: {
        findByCustomerId: jest.fn(),
        findByCustomerIdSafe: jest.fn(),
        findByIdWithItems: full,
        findByIdForCustomer: safe,
      },
    });
    const service = build(deps);
    const result = await service.getReturnDetail('r1', 'c1');
    expect(full).not.toHaveBeenCalled();
    expect(safe).toHaveBeenCalledWith('r1');
    expect((result as any).refundFailureReason).toBeUndefined();
    expect((result as any).qcInternalNotes).toBeUndefined();
    expect((result as any).riskScore).toBeUndefined();
    expect((result as any).refundFailureMessageCustomer).toMatch(
      /Our team is on it/,
    );
  });

  it('sanitizes status-history notes for non-CUSTOMER/ADMIN actors (#3)', async () => {
    const safe = jest.fn().mockResolvedValue({
      ...SAMPLE_SAFE_RETURN,
      statusHistory: [
        {
          id: 'h1',
          fromStatus: 'REQUESTED',
          toStatus: 'APPROVED',
          changedBy: 'SYSTEM',
          notes: 'Auto-approved: risk score 78 (HIGH) flags=[HIGH_VALUE]',
          createdAt: new Date(),
        },
        {
          id: 'h2',
          fromStatus: 'APPROVED',
          toStatus: 'REJECTED',
          changedBy: 'ADMIN',
          notes: 'Item condition does not match the reported defect',
          createdAt: new Date(),
        },
      ],
      evidence: [],
      refundTransactions: [],
    });
    const deps = buildDeps({
      returnRepo: {
        findByCustomerId: jest.fn(),
        findByCustomerIdSafe: jest.fn(),
        findByIdWithItems: jest.fn(),
        findByIdForCustomer: safe,
      },
    });
    const service = build(deps);
    const result: any = await service.getReturnDetail('r1', 'c1');
    const [systemRow, adminRow] = result.statusHistory;
    // SYSTEM note (leaks the risk score) is blanked.
    expect(systemRow.notes).toBeNull();
    // ADMIN reject reason is legitimately customer-facing.
    expect(adminRow.notes).toMatch(/does not match/);
  });

  it('rejects wrong-customer access', async () => {
    const deps = buildDeps({
      returnRepo: {
        findByCustomerId: jest.fn(),
        findByCustomerIdSafe: jest.fn(),
        findByIdWithItems: jest.fn(),
        findByIdForCustomer: jest.fn().mockResolvedValue({
          ...SAMPLE_SAFE_RETURN,
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
