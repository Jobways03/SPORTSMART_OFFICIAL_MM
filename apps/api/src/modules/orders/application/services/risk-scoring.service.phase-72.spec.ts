// Phase 72 (2026-05-22) — Phase 71 risk audit Gaps #12 + #17.
//
// Covers:
//   Gap #12 — service consults RiskRuleConfigService for weights /
//             thresholds; enabled=false skips the rule entirely
//   Gap #17 — maskAmounts on a value-rule emits bucketed reason text
//             instead of exact rupees

import { RiskScoringService } from './risk-scoring.service';

interface MockOpts {
  ruleOverrides?: Record<string, Partial<{
    scoreDelta: number;
    config: Record<string, any>;
    enabled: boolean;
    maskAmounts: boolean;
  }>>;
  totalAmount?: number;
  priorOrderCount?: number;
  itemCount?: number;
}

function makeSvc(opts: MockOpts = {}) {
  const order = {
    id: 'mo-1',
    orderStatus: 'PLACED',
    customerId: 'c-1',
    totalAmount: opts.totalAmount ?? 12_000,
    itemCount: opts.itemCount ?? 1,
    paymentMethod: 'ONLINE',
    paymentStatus: 'PAID',
    createdAt: new Date(),
    shippingFeeInPaise: 0n,
    shippingAddressSnapshot: { postalCode: '500001' },
    subOrders: [
      { id: 'so-1', items: [{ id: 'oi-1', productId: 'p-1', quantity: opts.itemCount ?? 1 }] },
    ],
    customer: { email: 'shopper@example.com' },
  };

  let cancellationCallSeen = false;
  const masterOrderCount = jest.fn().mockImplementation((args: any) => {
    const where = args?.where ?? {};
    if (!('createdAt' in where)) return Promise.resolve(opts.priorOrderCount ?? 0);
    if (where.orderStatus === 'CANCELLED') return Promise.resolve(0);
    if (!cancellationCallSeen) {
      cancellationCallSeen = true;
      return Promise.resolve(0);
    }
    return Promise.resolve(0);
  });

  const masterOrderFindUnique = jest.fn().mockResolvedValue(order);
  const masterOrderUpdate = jest.fn().mockResolvedValue({});
  const riskReasonDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const riskReasonCreateMany = jest.fn().mockResolvedValue({ count: 0 });
  const riskScoreHistoryCreate = jest.fn().mockResolvedValue({});

  const prisma: any = {
    masterOrder: {
      findUnique: masterOrderFindUnique,
      count: masterOrderCount,
      update: masterOrderUpdate,
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    orderRiskReason: { deleteMany: riskReasonDeleteMany, createMany: riskReasonCreateMany },
    orderRiskScoreHistory: { create: riskScoreHistoryCreate },
    $transaction: jest.fn(async (cb: any) =>
      cb({
        masterOrder: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        orderRiskReason: { deleteMany: riskReasonDeleteMany, createMany: riskReasonCreateMany },
        orderRiskScoreHistory: { create: riskScoreHistoryCreate },
      }),
    ),
  };

  const moneyDualWrite: any = { applyPaise: (_k: string, x: any) => x };

  // Build a stub RiskRuleConfigService.getAll() that returns DEFAULTS
  // merged with the test's overrides.
  const ruleConfig: any = {
    getAll: jest.fn().mockImplementation(async () => {
      // Mirror the in-service DEFAULTS shape.
      const defaults: Record<string, any> = {
        FIRST_TIME_CUSTOMER: { scoreDelta: 5, config: {}, enabled: true, maskAmounts: false },
        REPEAT_CUSTOMER: { scoreDelta: -10, config: {}, enabled: true, maskAmounts: false },
        COD_PAYMENT: { scoreDelta: 5, config: {}, enabled: true, maskAmounts: false },
        ONLINE_CAPTURED: { scoreDelta: -5, config: {}, enabled: true, maskAmounts: false },
        ONLINE_NOT_CAPTURED: { scoreDelta: 10, config: {}, enabled: true, maskAmounts: false },
        HIGH_VALUE: { scoreDelta: 10, config: { valueRupees: 10_000 }, enabled: true, maskAmounts: false },
        VERY_HIGH_VALUE: { scoreDelta: 20, config: { valueRupees: 25_000 }, enabled: true, maskAmounts: false },
        BULK_ORDER: { scoreDelta: 5, config: { itemThreshold: 10 }, enabled: true, maskAmounts: false },
        PINCODE_RTO: { scoreDelta: 10, config: { pincodes: [] }, enabled: true, maskAmounts: false },
        CANCELLATION_HISTORY: { scoreDelta: 15, config: { minPrior: 3, lookbackDays: 90, rateThreshold: 0.3 }, enabled: true, maskAmounts: false },
        SUSPICIOUS_EMAIL: { scoreDelta: 10, config: { domains: ['mailinator.com'] }, enabled: true, maskAmounts: false },
        VELOCITY: { scoreDelta: 10, config: { windowMinutes: 60, threshold: 3 }, enabled: true, maskAmounts: false },
        OTHER: { scoreDelta: 0, config: {}, enabled: false, maskAmounts: false },
      };
      for (const [code, override] of Object.entries(opts.ruleOverrides ?? {})) {
        defaults[code] = { ...defaults[code], ...override };
      }
      return defaults;
    }),
  };

  const svc = new RiskScoringService(prisma, moneyDualWrite, ruleConfig);
  return { svc, riskReasonCreateMany };
}

describe('RiskScoringService consults RiskRuleConfigService (Phase 72 — Gap #12)', () => {
  it('uses DB-driven scoreDelta override (HIGH_VALUE 10 → 25)', async () => {
    const { svc, riskReasonCreateMany } = makeSvc({
      totalAmount: 15_000,
      ruleOverrides: { HIGH_VALUE: { scoreDelta: 25 } },
    });
    await svc.scoreOrder('mo-1');
    const data = riskReasonCreateMany.mock.calls[0]![0].data;
    const highRow = data.find((r: any) => r.reasonCode === 'HIGH_VALUE');
    expect(highRow?.scoreDelta).toBe(25);
  });

  it('disabled rule does NOT fire (BULK_ORDER enabled=false)', async () => {
    const { svc, riskReasonCreateMany } = makeSvc({
      itemCount: 15,
      ruleOverrides: { BULK_ORDER: { enabled: false } },
    });
    await svc.scoreOrder('mo-1');
    const data = riskReasonCreateMany.mock.calls[0]![0].data;
    const codes = data.map((r: any) => r.reasonCode);
    expect(codes).not.toContain('BULK_ORDER');
  });

  it('DB-driven threshold lowers HIGH_VALUE bar to ₹5K', async () => {
    const { svc, riskReasonCreateMany } = makeSvc({
      totalAmount: 6_000,
      ruleOverrides: { HIGH_VALUE: { config: { valueRupees: 5_000 } } },
    });
    await svc.scoreOrder('mo-1');
    const data = riskReasonCreateMany.mock.calls[0]![0].data;
    const codes = data.map((r: any) => r.reasonCode);
    expect(codes).toContain('HIGH_VALUE');
  });

  it('Phase 72 Gap #17 — maskAmounts=true emits bucketed reason text', async () => {
    const { svc, riskReasonCreateMany } = makeSvc({
      totalAmount: 27_000,
      ruleOverrides: { VERY_HIGH_VALUE: { maskAmounts: true } },
    });
    await svc.scoreOrder('mo-1');
    const data = riskReasonCreateMany.mock.calls[0]![0].data;
    const veryHigh = data.find((r: any) => r.reasonCode === 'VERY_HIGH_VALUE');
    expect(veryHigh?.reasonText).toContain('≥₹25K');
    expect(veryHigh?.reasonText).not.toContain('₹27,000');
  });

  it('Phase 72 Gap #17 — maskAmounts=false (default) keeps exact rupees', async () => {
    const { svc, riskReasonCreateMany } = makeSvc({
      totalAmount: 27_000,
    });
    await svc.scoreOrder('mo-1');
    const data = riskReasonCreateMany.mock.calls[0]![0].data;
    const veryHigh = data.find((r: any) => r.reasonCode === 'VERY_HIGH_VALUE');
    expect(veryHigh?.reasonText).toMatch(/27[\.,]?000/);
  });

  it('DB-driven SUSPICIOUS_EMAIL domain list extension', async () => {
    const { svc, riskReasonCreateMany } = makeSvc({
      ruleOverrides: {
        SUSPICIOUS_EMAIL: { config: { domains: ['example.com'] } },
      },
    });
    await svc.scoreOrder('mo-1');
    const data = riskReasonCreateMany.mock.calls[0]![0].data;
    const codes = data.map((r: any) => r.reasonCode);
    expect(codes).toContain('SUSPICIOUS_EMAIL');
  });
});
