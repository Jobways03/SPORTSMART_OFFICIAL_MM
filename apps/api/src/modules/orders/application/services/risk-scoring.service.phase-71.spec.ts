// Phase 71 (2026-05-22) — Phase 70 risk-scoring audit fixes.
//
// Covers:
//   Gap #8  — OrderRiskScoreHistory append-only audit row per scoreOrder
//   Gap #9  — verificationScoredBy + verificationScoreSource (RULES vs MANUAL)
//   Gap #10 — verificationScoreVersion stamped to SCORER_VERSION
//   Gap #11 — new rules: CANCELLATION_HISTORY, SUSPICIOUS_EMAIL, VELOCITY
//   Gap #13 — shipping fee excluded from value threshold
//   Gap #19 — true item count from sub-orders, not header

import {
  RiskScoringService,
  SCORER_VERSION,
} from './risk-scoring.service';

interface MockOpts {
  order?: any;
  priorOrderCount?: number;
  windowedTotal?: number;
  windowedCancelled?: number;
  velocityCount?: number;
}

function makeSvc(opts: MockOpts = {}) {
  const order = opts.order ?? {
    id: 'mo-1',
    customerId: 'c-1',
    totalAmount: 9900,
    itemCount: 2,
    paymentMethod: 'ONLINE',
    paymentStatus: 'PAID',
    createdAt: new Date(),
    shippingFeeInPaise: 10_000n, // ₹100 shipping
    shippingAddressSnapshot: { postalCode: '500001' },
    subOrders: [
      { id: 'so-1', items: [{ id: 'oi-1', productId: 'p-1', quantity: 2 }] },
    ],
    customer: { email: 'shopper@example.com' },
  };

  // Distinguish count calls by their WHERE shape.
  let cancellationCallSeen = false;
  const masterOrderCount = jest.fn().mockImplementation((args: any) => {
    const where = args?.where ?? {};
    if (!('createdAt' in where)) {
      // total prior orders
      return Promise.resolve(opts.priorOrderCount ?? 0);
    }
    // windowed call. First windowed call is total in cancellation
    // window; second is cancelled in cancellation window; third is
    // velocity (different cutoff but same shape).
    // The cancellation pair runs first because of Promise.all order
    // — but `Promise.all` resolves in declaration order; the
    // service does cancellations first then velocity later. We
    // alternate via a captured flag.
    if (where.orderStatus === 'CANCELLED') {
      return Promise.resolve(opts.windowedCancelled ?? 0);
    }
    if (!cancellationCallSeen) {
      cancellationCallSeen = true;
      return Promise.resolve(opts.windowedTotal ?? 0);
    }
    return Promise.resolve(opts.velocityCount ?? 0);
  });

  const masterOrderFindUnique = jest.fn().mockResolvedValue(order);
  const masterOrderUpdate = jest.fn().mockResolvedValue({});
  const masterOrderFindMany = jest.fn().mockResolvedValue([]);
  const riskReasonDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const riskReasonCreateMany = jest.fn().mockResolvedValue({ count: 0 });
  const riskScoreHistoryCreate = jest.fn().mockResolvedValue({});

  const prisma: any = {
    masterOrder: {
      findUnique: masterOrderFindUnique,
      count: masterOrderCount,
      update: masterOrderUpdate,
      findMany: masterOrderFindMany,
    },
    orderRiskReason: {
      deleteMany: riskReasonDeleteMany,
      createMany: riskReasonCreateMany,
    },
    orderRiskScoreHistory: { create: riskScoreHistoryCreate },
    $transaction: jest.fn(async (cb: any) =>
      cb({
        masterOrder: { update: masterOrderUpdate },
        orderRiskReason: {
          deleteMany: riskReasonDeleteMany,
          createMany: riskReasonCreateMany,
        },
        orderRiskScoreHistory: { create: riskScoreHistoryCreate },
      }),
    ),
  };

  const moneyDualWrite: any = {
    applyPaise: (_kind: string, data: any) => data,
  };

  const svc = new RiskScoringService(prisma, moneyDualWrite);
  return { svc, masterOrderUpdate, riskReasonCreateMany, riskScoreHistoryCreate };
}

describe('RiskScoringService (Phase 71 — risk hardening)', () => {
  it('Gap #8/#9/#10 — writes OrderRiskScoreHistory + stamps source/scoredBy/version on auto path', async () => {
    const { svc, masterOrderUpdate, riskScoreHistoryCreate } = makeSvc();
    await svc.scoreOrder('mo-1');
    expect(riskScoreHistoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          masterOrderId: 'mo-1',
          source: 'RULES',
          scoredBy: null,
          scorerVersion: SCORER_VERSION,
        }),
      }),
    );
    expect(masterOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationScoreSource: 'RULES',
          verificationScoredBy: null,
          verificationScoreVersion: SCORER_VERSION,
        }),
      }),
    );
  });

  it('Gap #9 — manual rescore records source=MANUAL + scoredBy=adminId', async () => {
    const { svc, masterOrderUpdate, riskScoreHistoryCreate } = makeSvc();
    await svc.rescore('mo-1', 'admin-42');
    expect(masterOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationScoreSource: 'MANUAL',
          verificationScoredBy: 'admin-42',
        }),
      }),
    );
    expect(riskScoreHistoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'MANUAL',
          scoredBy: 'admin-42',
        }),
      }),
    );
  });

  it('Gap #13 — shipping fee excluded from value threshold (₹9,900 + ₹100 shipping = NOT high value)', async () => {
    const { svc, riskReasonCreateMany } = makeSvc({
      order: {
        id: 'mo-shippy',
        customerId: 'c-1',
        totalAmount: 10000, // includes ₹100 shipping
        itemCount: 1,
        paymentMethod: 'ONLINE',
        paymentStatus: 'PAID',
        createdAt: new Date(),
        shippingFeeInPaise: 10_000n, // ₹100
        shippingAddressSnapshot: { postalCode: '500001' },
        subOrders: [{ id: 'so-1', items: [{ id: 'oi-1', productId: 'p-1', quantity: 1 }] }],
        customer: { email: 'a@b.com' },
      },
      priorOrderCount: 5,
    });
    await svc.scoreOrder('mo-shippy');
    const created = riskReasonCreateMany.mock.calls[0]![0].data;
    const codes = created.map((r: any) => r.reasonCode);
    expect(codes).not.toContain('HIGH_VALUE');
    expect(codes).not.toContain('VERY_HIGH_VALUE');
  });

  it('Gap #11 — CANCELLATION_HISTORY fires when rate > 30%', async () => {
    const { svc, riskReasonCreateMany } = makeSvc({
      priorOrderCount: 10,
      windowedTotal: 8,
      windowedCancelled: 5, // 62%
    });
    await svc.scoreOrder('mo-1');
    const created = riskReasonCreateMany.mock.calls[0]![0].data;
    const codes = created.map((r: any) => r.reasonCode);
    expect(codes).toContain('CANCELLATION_HISTORY');
  });

  it('Gap #11 — CANCELLATION_HISTORY does NOT fire with only 2 prior orders', async () => {
    const { svc, riskReasonCreateMany } = makeSvc({
      priorOrderCount: 2,
      windowedTotal: 2,
      windowedCancelled: 2,
    });
    await svc.scoreOrder('mo-1');
    const created = riskReasonCreateMany.mock.calls[0]![0].data;
    const codes = created.map((r: any) => r.reasonCode);
    expect(codes).not.toContain('CANCELLATION_HISTORY');
  });

  it('Gap #11 — SUSPICIOUS_EMAIL fires for disposable domain', async () => {
    const { svc, riskReasonCreateMany } = makeSvc({
      order: {
        id: 'mo-disp',
        customerId: 'c-1',
        totalAmount: 500,
        itemCount: 1,
        paymentMethod: 'ONLINE',
        paymentStatus: 'PAID',
        createdAt: new Date(),
        shippingFeeInPaise: 0n,
        shippingAddressSnapshot: { postalCode: '500001' },
        subOrders: [{ id: 'so-1', items: [{ id: 'oi-1', productId: 'p-1', quantity: 1 }] }],
        customer: { email: 'spammer@mailinator.com' },
      },
    });
    await svc.scoreOrder('mo-disp');
    const created = riskReasonCreateMany.mock.calls[0]![0].data;
    const codes = created.map((r: any) => r.reasonCode);
    expect(codes).toContain('SUSPICIOUS_EMAIL');
  });

  it('Gap #11 — SUSPICIOUS_EMAIL does NOT fire for normal domain', async () => {
    const { svc, riskReasonCreateMany } = makeSvc();
    await svc.scoreOrder('mo-1');
    const created = riskReasonCreateMany.mock.calls[0]![0].data;
    const codes = created.map((r: any) => r.reasonCode);
    expect(codes).not.toContain('SUSPICIOUS_EMAIL');
  });

  it('Gap #11 — VELOCITY fires when > 3 orders in last hour', async () => {
    const { svc, riskReasonCreateMany } = makeSvc({
      priorOrderCount: 5,
      velocityCount: 4,
    });
    await svc.scoreOrder('mo-1');
    const created = riskReasonCreateMany.mock.calls[0]![0].data;
    const codes = created.map((r: any) => r.reasonCode);
    expect(codes).toContain('VELOCITY');
  });

  it('Gap #19 — uses sub-order items count for BULK_ORDER, not header itemCount', async () => {
    const { svc, riskReasonCreateMany } = makeSvc({
      order: {
        id: 'mo-bulk',
        customerId: 'c-1',
        totalAmount: 500,
        itemCount: 1, // header LIES; sub-orders have 12 real items
        paymentMethod: 'ONLINE',
        paymentStatus: 'PAID',
        createdAt: new Date(),
        shippingFeeInPaise: 0n,
        shippingAddressSnapshot: { postalCode: '500001' },
        subOrders: [
          { id: 'so-1', items: [{ id: 'oi-1', productId: 'p-1', quantity: 6 }, { id: 'oi-2', productId: 'p-2', quantity: 6 }] },
        ],
        customer: { email: 'a@b.com' },
      },
    });
    await svc.scoreOrder('mo-bulk');
    const created = riskReasonCreateMany.mock.calls[0]![0].data;
    const codes = created.map((r: any) => r.reasonCode);
    expect(codes).toContain('BULK_ORDER');
  });
});
