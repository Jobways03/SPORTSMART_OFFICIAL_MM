// Phase 109 (2026-05-25) — Section 34 time-bar double-refund guard.
//
// A time-barred return is refunded ONLY via its TIME_BARRED_CREDIT_NOTE wallet
// adjustment (finance-approved). initiateRefund must refuse such returns so a
// manual/retried call can't pay the customer a second time on top of the
// adjustment.

import { ReturnService } from './return.service';

function buildDeps(overrides: any = {}) {
  return {
    returnRepo: {
      findByIdWithItems: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'r1', status: 'REFUNDED' }),
      recordStatusChange: jest.fn().mockResolvedValue({}),
    },
    prisma: {
      return: { findFirst: jest.fn().mockResolvedValue(null) },
      refundTransaction: { create: jest.fn().mockResolvedValue({}) },
    },
    eligibilityService: {},
    autoApprovalService: {},
    stockRestorationService: {},
    commissionReversalService: {},
    refundGateway: { processRefund: jest.fn() },
    media: {},
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

const baseRet = {
  id: 'r1',
  returnNumber: 'RET-1',
  status: 'QC_APPROVED',
  refundAmount: 100,
  refundAttempts: 0,
  customerId: 'c1',
  masterOrder: { id: 'mo1', orderNumber: 'ON1', paymentMethod: 'ONLINE' },
};

describe('ReturnService.initiateRefund — Section 34 time-bar guard (Phase 109)', () => {
  it('refuses a direct refund for a TIME_BARRED return and never calls the gateway (double-pay guard)', async () => {
    const deps = buildDeps({
      returnRepo: {
        ...buildDeps().returnRepo,
        findByIdWithItems: jest
          .fn()
          .mockResolvedValue({ ...baseRet, creditNoteEligibilityStatus: 'TIME_BARRED' }),
      },
    });
    const service = build(deps);

    await expect(
      service.initiateRefund('r1', 'SYSTEM', 'admin-1', 'ORIGINAL_PAYMENT'),
    ).rejects.toThrow(/time-barred/i);
    expect(deps.refundGateway.processRefund).not.toHaveBeenCalled();
  });

  it('proceeds to the gateway for an ELIGIBLE (non-time-barred) return', async () => {
    const deps = buildDeps({
      returnRepo: {
        ...buildDeps().returnRepo,
        findByIdWithItems: jest
          .fn()
          .mockResolvedValue({ ...baseRet, creditNoteEligibilityStatus: 'ELIGIBLE' }),
      },
      refundGateway: {
        processRefund: jest.fn().mockResolvedValue({
          success: true,
          completed: true,
          gatewayRefundId: 'g1',
          requiresManualProcessing: false,
        }),
      },
    });
    const service = build(deps);

    await service.initiateRefund('r1', 'SYSTEM', 'admin-1', 'WALLET');
    expect(deps.refundGateway.processRefund).toHaveBeenCalledTimes(1);
  });
});
