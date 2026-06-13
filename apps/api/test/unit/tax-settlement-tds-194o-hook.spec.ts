import 'reflect-metadata';
import { SettlementTds194OHookService } from '../../src/modules/tax/application/services/settlement-tds-194o-hook.service';

// Phase 27 — SettlementTds194OHookService tests.
//
// Unit-level: prisma + Tds194OService are mocked. The headline case is the
// per-settlement-slice regression (see "splits the quarterly TDS …"): the hook
// must stamp each settlement with TDS on its OWN net gross sale, NOT the whole
// quarter's aggregate (ledger.tdsInPaise). Pre-fix a seller settled N times in
// a quarter was withheld the full quarterly TDS on each payout.

interface MockPrisma {
  settlementCycle: { findUnique: jest.Mock };
  sellerSettlement: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  section194OTdsLedger: { findUnique: jest.Mock };
}

interface MockTds {
  computeForSeller: jest.Mock;
  markWithheld: jest.Mock;
}

function makeService(): {
  service: SettlementTds194OHookService;
  prisma: MockPrisma;
  tds: MockTds;
} {
  const prisma: MockPrisma = {
    settlementCycle: { findUnique: jest.fn() },
    sellerSettlement: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    section194OTdsLedger: { findUnique: jest.fn() },
  };
  const tds: MockTds = {
    computeForSeller: jest.fn(),
    markWithheld: jest.fn(),
  };
  // Phase 252 — TDS slice reads the configured base; default to product (PGS)
  // so these tests keep computing on totalPlatformAmountInPaise.
  const taxConfig = {
    getSettlementTaxConfig: jest.fn().mockResolvedValue({
      gst: { rateBps: 1800, baseType: 'COMMISSION' },
      tcs: { rateBps: 100, baseType: 'PRICE_OF_GOODS_SOLD' },
      tds: { rateBps: 100, baseType: 'PRICE_OF_GOODS_SOLD' },
    }),
  };
  const service = new SettlementTds194OHookService(
    prisma as any,
    tds as any,
    taxConfig as any,
  );
  return { service, prisma, tds };
}

/** Stamp-recording update mock: echoes {id, ...data}. */
function echoUpdate(prisma: MockPrisma): void {
  prisma.sellerSettlement.update.mockImplementation(async (args: any) => ({
    id: args.where.id,
    ...args.data,
  }));
}

describe('SettlementTds194OHookService.applyToCycleOnApprove', () => {
  it('throws on unknown cycle', async () => {
    const { service, prisma } = makeService();
    prisma.settlementCycle.findUnique.mockResolvedValue(null);
    await expect(
      service.applyToCycleOnApprove({ cycleId: 'nope' }),
    ).rejects.toThrow(/not found/);
  });

  it('splits the quarterly TDS into per-settlement slices (regression: must NOT stamp the whole-quarter aggregate on every settlement)', async () => {
    const { service, prisma, tds } = makeService();
    prisma.settlementCycle.findUnique.mockResolvedValue({
      id: 'cyc-1',
      periodEnd: new Date(Date.UTC(2026, 3, 30)), // April 2026 → FY26 Q1
    });
    // Two settlements, SAME seller, SAME quarter.
    prisma.sellerSettlement.findMany.mockResolvedValue([
      { id: 'ss-1', sellerId: 'sel-1', tdsLedgerId: null },
      { id: 'ss-2', sellerId: 'sel-1', tdsLedgerId: null },
    ]);
    // computeForSeller is idempotent per (seller, quarter): both settlements
    // resolve to the SAME quarterly ledger. tdsInPaise is the whole quarter's
    // TDS = 1% of ₹10,000 gross = ₹100 = 10_000 paise. Pre-fix this 10_000n was
    // stamped on BOTH settlements (₹200 withheld against ₹100 owed).
    tds.computeForSeller.mockResolvedValue({
      ledger: { id: 'tds-q1', tdsInPaise: 10_000n, tdsRateBps: 100 },
      isNew: true,
      skipped: false,
    });
    // Per-settlement gross bases: ss-1 = ₹4,000, ss-2 = ₹6,000 (sum ₹10,000).
    prisma.sellerSettlement.findUnique.mockImplementation(
      async ({ where }: any) => {
        const bases: Record<string, any> = {
          'ss-1': { totalPlatformAmountInPaise: 400_000n, adjustments: [] },
          'ss-2': { totalPlatformAmountInPaise: 600_000n, adjustments: [] },
        };
        return bases[where.id] ?? null;
      },
    );
    echoUpdate(prisma);

    const result = await service.applyToCycleOnApprove({ cycleId: 'cyc-1' });

    expect(result.settlementsProcessed).toBe(2);
    // 1% of ₹4,000 = ₹40 = 4_000 paise; 1% of ₹6,000 = ₹60 = 6_000 paise.
    const byId: Record<string, bigint> = {};
    for (const call of prisma.sellerSettlement.update.mock.calls) {
      byId[call[0].where.id] = call[0].data.tdsDeductedInPaise;
    }
    expect(byId['ss-1']).toBe(4_000n); // NOT 10_000n
    expect(byId['ss-2']).toBe(6_000n); // NOT 10_000n
    // Slices reconcile to the quarterly ledger total — no over-deduction.
    expect(result.totalTdsDeductedInPaise).toBe(10_000n); // NOT 20_000n
    // The ledger link + rate snapshot are still stamped.
    const first = prisma.sellerSettlement.update.mock.calls[0][0];
    expect(first.data).toMatchObject({
      tdsLedgerId: 'tds-q1',
      tdsRateBpsSnapshot: 100,
      tdsFilingPeriod: '2026-Q1',
    });
  });

  it('applies the 5% (no-PAN) rate from the ledger snapshot to the per-settlement slice', async () => {
    const { service, prisma, tds } = makeService();
    prisma.settlementCycle.findUnique.mockResolvedValue({
      id: 'cyc-pan',
      periodEnd: new Date(Date.UTC(2026, 3, 30)),
    });
    prisma.sellerSettlement.findMany.mockResolvedValue([
      { id: 'ss-np', sellerId: 'sel-np', tdsLedgerId: null },
    ]);
    tds.computeForSeller.mockResolvedValue({
      ledger: { id: 'tds-np', tdsInPaise: 99_999n, tdsRateBps: 500 },
      isNew: true,
      skipped: false,
    });
    prisma.sellerSettlement.findUnique.mockResolvedValue({
      totalPlatformAmountInPaise: 400_000n, // ₹4,000
      adjustments: [],
    });
    echoUpdate(prisma);

    const result = await service.applyToCycleOnApprove({ cycleId: 'cyc-pan' });
    // 5% of ₹4,000 = ₹200 = 20_000 paise (uses the snapshot rate, not 1%).
    expect(result.totalTdsDeductedInPaise).toBe(20_000n);
  });

  it('nets this settlement’s own negative adjustments and clamps at zero', async () => {
    const { service, prisma, tds } = makeService();
    prisma.settlementCycle.findUnique.mockResolvedValue({
      id: 'cyc-neg',
      periodEnd: new Date(Date.UTC(2026, 3, 30)),
    });
    prisma.sellerSettlement.findMany.mockResolvedValue([
      { id: 'ss-neg', sellerId: 'sel-neg', tdsLedgerId: null },
    ]);
    tds.computeForSeller.mockResolvedValue({
      ledger: { id: 'tds-neg', tdsInPaise: 0n, tdsRateBps: 100 },
      isNew: true,
      skipped: false,
    });
    // Gross ₹1,000 but refunds/clawbacks of ₹1,500 → net negative → 0 TDS.
    prisma.sellerSettlement.findUnique.mockResolvedValue({
      totalPlatformAmountInPaise: 100_000n,
      adjustments: [{ amountInPaise: -150_000n }],
    });
    echoUpdate(prisma);

    const result = await service.applyToCycleOnApprove({ cycleId: 'cyc-neg' });
    const stamped =
      prisma.sellerSettlement.update.mock.calls[0][0].data.tdsDeductedInPaise;
    expect(stamped).toBe(0n);
    expect(result.totalTdsDeductedInPaise).toBe(0n);
  });

  it('skips settlements that already carry a tdsLedgerId (idempotent)', async () => {
    const { service, prisma, tds } = makeService();
    prisma.settlementCycle.findUnique.mockResolvedValue({
      id: 'cyc-2',
      periodEnd: new Date(Date.UTC(2026, 3, 30)),
    });
    prisma.sellerSettlement.findMany.mockResolvedValue([
      { id: 'ss-a', sellerId: 'sel-a', tdsLedgerId: 'tds-existing' },
      { id: 'ss-b', sellerId: 'sel-b', tdsLedgerId: null },
    ]);
    tds.computeForSeller.mockResolvedValue({
      ledger: { id: 'tds-b', tdsInPaise: 10_000n, tdsRateBps: 100 },
      isNew: true,
      skipped: false,
    });
    prisma.sellerSettlement.findUnique.mockResolvedValue({
      totalPlatformAmountInPaise: 500_000n,
      adjustments: [],
    });
    echoUpdate(prisma);

    const result = await service.applyToCycleOnApprove({ cycleId: 'cyc-2' });
    expect(result.settlementsProcessed).toBe(1);
    expect(result.settlementsSkipped).toBe(1);
    expect(tds.computeForSeller).toHaveBeenCalledTimes(1);
  });

  it('records the skip reason for exempt / no-activity sellers without stamping a ledger', async () => {
    const { service, prisma, tds } = makeService();
    prisma.settlementCycle.findUnique.mockResolvedValue({
      id: 'cyc-ex',
      periodEnd: new Date(Date.UTC(2026, 3, 30)),
    });
    prisma.sellerSettlement.findMany.mockResolvedValue([
      { id: 'ss-ex', sellerId: 'sel-ex', tdsLedgerId: null },
      { id: 'ss-na', sellerId: 'sel-na', tdsLedgerId: null },
    ]);
    tds.computeForSeller
      .mockResolvedValueOnce({ ledger: null, skipped: true, skipReason: 'EXEMPT' })
      .mockResolvedValueOnce({
        ledger: null,
        skipped: true,
        skipReason: 'NO_ACTIVITY',
      });
    echoUpdate(prisma);

    const result = await service.applyToCycleOnApprove({ cycleId: 'cyc-ex' });
    expect(result.settlementsProcessed).toBe(0);
    expect(result.settlementsExempt).toBe(1);
    expect(result.settlementsSkipped).toBe(1);
    // Both rows get tdsSkipReason persisted; neither gets a tdsLedgerId.
    const reasons = prisma.sellerSettlement.update.mock.calls.map(
      (c) => c[0].data.tdsSkipReason,
    );
    expect(reasons).toEqual(
      expect.arrayContaining(['EXEMPT', 'NO_ACTIVITY']),
    );
  });

  it('continues past a per-seller compute failure', async () => {
    const { service, prisma, tds } = makeService();
    prisma.settlementCycle.findUnique.mockResolvedValue({
      id: 'cyc-3',
      periodEnd: new Date(Date.UTC(2026, 3, 30)),
    });
    prisma.sellerSettlement.findMany.mockResolvedValue([
      { id: 'ss-x', sellerId: 'sel-x', tdsLedgerId: null },
      { id: 'ss-y', sellerId: 'sel-y', tdsLedgerId: null },
    ]);
    tds.computeForSeller
      .mockRejectedValueOnce(new Error('seller PAN lookup failed'))
      .mockResolvedValueOnce({
        ledger: { id: 'tds-y', tdsInPaise: 5_000n, tdsRateBps: 100 },
        isNew: true,
        skipped: false,
      });
    prisma.sellerSettlement.findUnique.mockResolvedValue({
      totalPlatformAmountInPaise: 200_000n, // ₹2,000 → 1% = ₹20
      adjustments: [],
    });
    echoUpdate(prisma);

    const result = await service.applyToCycleOnApprove({ cycleId: 'cyc-3' });
    expect(result.settlementsProcessed).toBe(1);
    expect(result.settlementsFailed).toBe(1);
    expect(result.failedSettlementIds).toEqual(['ss-x']);
    expect(result.totalTdsDeductedInPaise).toBe(2_000n);
  });

  it('derives the quarterly filing period from the cycle periodEnd', async () => {
    const { service, prisma } = makeService();
    prisma.settlementCycle.findUnique.mockResolvedValue({
      id: 'cyc-4',
      periodEnd: new Date(Date.UTC(2026, 9, 15)), // 15 Oct 2026 IST → FY26 Q3
    });
    prisma.sellerSettlement.findMany.mockResolvedValue([]);
    const result = await service.applyToCycleOnApprove({ cycleId: 'cyc-4' });
    expect(result.filingPeriod).toBe('2026-Q3');
  });
});

describe('SettlementTds194OHookService.markWithheldOnPay', () => {
  it('returns flipped=false when settlement has no tdsLedgerId', async () => {
    const { service, prisma, tds } = makeService();
    prisma.sellerSettlement.findUnique.mockResolvedValue({ tdsLedgerId: null });
    const result = await service.markWithheldOnPay({ settlementId: 'ss-1' });
    expect(result.flipped).toBe(false);
    expect(result.ledgerId).toBeNull();
    expect(tds.markWithheld).not.toHaveBeenCalled();
  });

  it('handles a missing-ledger orphan link without throwing', async () => {
    const { service, prisma, tds } = makeService();
    prisma.sellerSettlement.findUnique.mockResolvedValue({
      tdsLedgerId: 'tds-orphan',
    });
    prisma.section194OTdsLedger.findUnique.mockResolvedValue(null);
    const result = await service.markWithheldOnPay({ settlementId: 'ss-1' });
    expect(result.flipped).toBe(false);
    expect(result.ledgerId).toBe('tds-orphan');
    expect(tds.markWithheld).not.toHaveBeenCalled();
  });

  it('is idempotent when ledger is already WITHHELD', async () => {
    const { service, prisma, tds } = makeService();
    prisma.sellerSettlement.findUnique.mockResolvedValue({
      tdsLedgerId: 'tds-1',
    });
    prisma.section194OTdsLedger.findUnique.mockResolvedValue({
      status: 'WITHHELD',
    });
    const result = await service.markWithheldOnPay({ settlementId: 'ss-1' });
    expect(result.flipped).toBe(false);
    expect(tds.markWithheld).not.toHaveBeenCalled();
  });

  it('flips COMPUTED → WITHHELD', async () => {
    const { service, prisma, tds } = makeService();
    prisma.sellerSettlement.findUnique.mockResolvedValue({
      tdsLedgerId: 'tds-1',
    });
    prisma.section194OTdsLedger.findUnique.mockResolvedValue({
      status: 'COMPUTED',
    });
    tds.markWithheld.mockResolvedValue({ id: 'tds-1', status: 'WITHHELD' });
    const result = await service.markWithheldOnPay({ settlementId: 'ss-1' });
    expect(result.flipped).toBe(true);
    expect(result.ledgerId).toBe('tds-1');
    expect(tds.markWithheld).toHaveBeenCalledWith({
      ledgerId: 'tds-1',
      settlementId: 'ss-1',
    });
  });
});

describe('SettlementTds194OHookService.computeNetPayoutInPaise', () => {
  it('subtracts TCS, TDS, and commission GST from the total settlement', () => {
    const net = SettlementTds194OHookService.computeNetPayoutInPaise({
      totalSettlementAmountInPaise: 10_000_000n, // ₹1,00,000
      tcsDeductedInPaise: 10_000n, // ₹100
      tdsDeductedInPaise: 10_000n, // ₹100
      totalCommissionGstInPaise: 1_80_000n, // ₹1,800
    });
    expect(net).toBe(10_000_000n - 10_000n - 10_000n - 1_80_000n);
  });
});
