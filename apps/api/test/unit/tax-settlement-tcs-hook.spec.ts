import 'reflect-metadata';
import { SettlementTcsHookService } from '../../src/modules/tax/application/services/settlement-tcs-hook.service';

// Phase 17 GST — SettlementTcsHookService tests.
//
// Unit-level: prisma + TcsService are mocked. Integration with the
// real SettlementService.approveCycle / markSettlementPaid lives in
// Phase 27 integration tests.

interface MockPrisma {
  settlementCycle: { findUnique: jest.Mock };
  sellerSettlement: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  gstTcsSettlementLedger: { findUnique: jest.Mock };
  commissionRecord: { findMany: jest.Mock };
  taxDocument: { findMany: jest.Mock };
}

interface MockTcs {
  computeForSeller: jest.Mock;
  markCollected: jest.Mock;
}

function makeService(): {
  service: SettlementTcsHookService;
  prisma: MockPrisma;
  tcs: MockTcs;
} {
  const prisma: MockPrisma = {
    settlementCycle: { findUnique: jest.fn() },
    sellerSettlement: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    gstTcsSettlementLedger: { findUnique: jest.fn() },
    commissionRecord: { findMany: jest.fn() },
    taxDocument: { findMany: jest.fn() },
  };
  const tcs: MockTcs = {
    computeForSeller: jest.fn(),
    markCollected: jest.fn(),
  };
  // Phase 253 — TCS slice reads the configured base off the settlement; the
  // CA-approved default is TAXABLE_SUPPLY (net taxable value, ex-GST). `enabled`
  // must be present or the master-toggle gate skips the whole cycle.
  const taxConfig = {
    getSettlementTaxConfig: jest.fn().mockResolvedValue({
      gst: { rateBps: 1800, baseType: 'COMMISSION', enabled: true },
      tcs: { rateBps: 100, baseType: 'TAXABLE_SUPPLY', enabled: true },
      tds: { rateBps: 100, baseType: 'COMMISSION', enabled: false },
    }),
  };
  const service = new SettlementTcsHookService(
    prisma as any,
    tcs as any,
    taxConfig as any,
  );
  return { service, prisma, tcs };
}

/**
 * Phase 253 — wire sellerSettlement.findUnique so the per-settlement TCS slice
 * (base × rate on the configured settlement column — default TAXABLE_SUPPLY)
 * returns a deterministic base per settlement. `baseBySettlement` maps a
 * settlementId to its net taxable supply (paise); the per-settlement TCS is
 * rate × that.
 */
function mockPerSettlementTaxable(
  prisma: MockPrisma,
  baseBySettlement: Record<string, bigint>,
): void {
  prisma.sellerSettlement.findUnique.mockImplementation(
    async ({ where }: any) => ({
      totalPlatformMarginInPaise: 0n,
      totalPlatformAmountInPaise: 0n,
      totalCommissionGstInPaise: 0n,
      totalTaxableSupplyInPaise: baseBySettlement[where.id] ?? 0n,
    }),
  );
}

describe('SettlementTcsHookService.applyToCycleOnApprove', () => {
  it('throws on unknown cycle', async () => {
    const { service, prisma } = makeService();
    prisma.settlementCycle.findUnique.mockResolvedValue(null);
    await expect(
      service.applyToCycleOnApprove({ cycleId: 'nope' }),
    ).rejects.toThrow(/not found/);
  });

  it('iterates settlements + stamps TCS columns', async () => {
    const { service, prisma, tcs } = makeService();
    prisma.settlementCycle.findUnique.mockResolvedValue({
      id: 'cyc-1',
      periodEnd: new Date(Date.UTC(2026, 3, 30)), // April 2026
    });
    prisma.sellerSettlement.findMany.mockResolvedValue([
      {
        id: 'ss-1',
        sellerId: 'sel-1',
        tcsLedgerId: null,
        totalSettlementAmountInPaise: 1_00_00_00n,
      },
      {
        id: 'ss-2',
        sellerId: 'sel-2',
        tcsLedgerId: null,
        totalSettlementAmountInPaise: 2_00_00_00n,
      },
    ]);
    tcs.computeForSeller
      .mockResolvedValueOnce({
        ledger: {
          id: 'tcs-1',
          totalTcsInPaise: 10_000n,
          tcsRateBps: 100,
        },
        isNew: true,
      })
      .mockResolvedValueOnce({
        ledger: {
          id: 'tcs-2',
          totalTcsInPaise: 20_000n,
          tcsRateBps: 100,
        },
        isNew: true,
      });
    prisma.sellerSettlement.update.mockImplementation(async (args: any) => ({
      id: args.where.id,
      ...args.data,
    }));

    mockPerSettlementTaxable(prisma, { 'ss-1': 800_000n, 'ss-2': 1_600_000n });

    const result = await service.applyToCycleOnApprove({ cycleId: 'cyc-1' });
    expect(result.settlementsProcessed).toBe(2);
    expect(result.settlementsSkipped).toBe(0);
    // Per-settlement slices: 1% of ₹8,000 = ₹80 and 1% of ₹16,000 = ₹160
    // (NOT the monthly ledger aggregate, which is deposited once per period).
    expect(result.totalTcsDeductedInPaise).toBe(24_000n);
    expect(result.filingPeriod).toBe('2026-04');
    expect(prisma.sellerSettlement.update).toHaveBeenCalledTimes(2);
    const first = prisma.sellerSettlement.update.mock.calls[0][0];
    expect(first.data).toMatchObject({
      tcsLedgerId: 'tcs-1',
      tcsDeductedInPaise: 8_000n,
      tcsRateBpsSnapshot: 100,
      tcsFilingPeriod: '2026-04',
    });
  });

  it('skips settlements that already carry a tcsLedgerId (idempotent)', async () => {
    const { service, prisma, tcs } = makeService();
    prisma.settlementCycle.findUnique.mockResolvedValue({
      id: 'cyc-2',
      periodEnd: new Date(Date.UTC(2026, 3, 30)),
    });
    prisma.sellerSettlement.findMany.mockResolvedValue([
      {
        id: 'ss-a',
        sellerId: 'sel-a',
        tcsLedgerId: 'tcs-existing',
        totalSettlementAmountInPaise: 1_00_00_00n,
      },
      {
        id: 'ss-b',
        sellerId: 'sel-b',
        tcsLedgerId: null,
        totalSettlementAmountInPaise: 1_00_00_00n,
      },
    ]);
    tcs.computeForSeller.mockResolvedValue({
      ledger: { id: 'tcs-b', totalTcsInPaise: 10_000n, tcsRateBps: 100 },
      isNew: true,
    });
    prisma.sellerSettlement.update.mockImplementation(async (args: any) => ({
      id: args.where.id,
      ...args.data,
    }));

    mockPerSettlementTaxable(prisma, { 'ss-b': 500_000n });

    const result = await service.applyToCycleOnApprove({ cycleId: 'cyc-2' });
    expect(result.settlementsProcessed).toBe(1);
    expect(result.settlementsSkipped).toBe(1);
    expect(tcs.computeForSeller).toHaveBeenCalledTimes(1);
    expect(prisma.sellerSettlement.update).toHaveBeenCalledTimes(1);
  });

  it('continues past a per-seller compute failure', async () => {
    const { service, prisma, tcs } = makeService();
    prisma.settlementCycle.findUnique.mockResolvedValue({
      id: 'cyc-3',
      periodEnd: new Date(Date.UTC(2026, 3, 30)),
    });
    prisma.sellerSettlement.findMany.mockResolvedValue([
      {
        id: 'ss-x',
        sellerId: 'sel-x',
        tcsLedgerId: null,
        totalSettlementAmountInPaise: 1_00_00_00n,
      },
      {
        id: 'ss-y',
        sellerId: 'sel-y',
        tcsLedgerId: null,
        totalSettlementAmountInPaise: 2_00_00_00n,
      },
    ]);
    tcs.computeForSeller
      .mockRejectedValueOnce(new Error('seller has invalid invoices'))
      .mockResolvedValueOnce({
        ledger: { id: 'tcs-y', totalTcsInPaise: 5_000n, tcsRateBps: 100 },
        isNew: true,
      });
    prisma.sellerSettlement.update.mockImplementation(async (args: any) => ({
      id: args.where.id,
      ...args.data,
    }));

    mockPerSettlementTaxable(prisma, { 'ss-y': 700_000n });

    const result = await service.applyToCycleOnApprove({ cycleId: 'cyc-3' });
    expect(result.settlementsProcessed).toBe(1);
    expect(result.settlementsSkipped).toBe(0);
    // Slice for ss-y: 1% of ₹7,000 = ₹70 (failed ss-x contributes nothing).
    expect(result.totalTcsDeductedInPaise).toBe(7_000n);
  });

  it('uses the cycle periodEnd to derive filing period', async () => {
    const { service, prisma } = makeService();
    // Cycle ending 1 May IST = 30 Apr 18:30 UTC. periodEnd in UTC:
    prisma.settlementCycle.findUnique.mockResolvedValue({
      id: 'cyc-4',
      periodEnd: new Date(Date.UTC(2026, 4, 1, 0, 0, 0)), // 1 May UTC
    });
    prisma.sellerSettlement.findMany.mockResolvedValue([]);
    const result = await service.applyToCycleOnApprove({ cycleId: 'cyc-4' });
    // 1 May UTC + 5:30 = 1 May 05:30 IST → still in May.
    expect(result.filingPeriod).toBe('2026-05');
  });
});

describe('SettlementTcsHookService.markCollectedOnPay', () => {
  it('returns flipped=false when settlement has no tcsLedgerId', async () => {
    const { service, prisma, tcs } = makeService();
    prisma.sellerSettlement.findUnique.mockResolvedValue({
      tcsLedgerId: null,
    });
    const result = await service.markCollectedOnPay({ settlementId: 'ss-1' });
    expect(result.flipped).toBe(false);
    expect(result.ledgerId).toBeNull();
    expect(tcs.markCollected).not.toHaveBeenCalled();
  });

  it('handles missing-ledger orphan link without throwing', async () => {
    const { service, prisma, tcs } = makeService();
    prisma.sellerSettlement.findUnique.mockResolvedValue({
      tcsLedgerId: 'tcs-orphan',
    });
    prisma.gstTcsSettlementLedger.findUnique.mockResolvedValue(null);
    const result = await service.markCollectedOnPay({ settlementId: 'ss-1' });
    expect(result.flipped).toBe(false);
    expect(result.ledgerId).toBe('tcs-orphan');
    expect(tcs.markCollected).not.toHaveBeenCalled();
  });

  it('is idempotent when ledger is already COLLECTED', async () => {
    const { service, prisma, tcs } = makeService();
    prisma.sellerSettlement.findUnique.mockResolvedValue({
      tcsLedgerId: 'tcs-1',
    });
    prisma.gstTcsSettlementLedger.findUnique.mockResolvedValue({
      status: 'COLLECTED',
    });
    const result = await service.markCollectedOnPay({ settlementId: 'ss-1' });
    expect(result.flipped).toBe(false);
    expect(tcs.markCollected).not.toHaveBeenCalled();
  });

  it('is idempotent when ledger is already FILED', async () => {
    const { service, prisma, tcs } = makeService();
    prisma.sellerSettlement.findUnique.mockResolvedValue({
      tcsLedgerId: 'tcs-1',
    });
    prisma.gstTcsSettlementLedger.findUnique.mockResolvedValue({
      status: 'FILED',
    });
    const result = await service.markCollectedOnPay({ settlementId: 'ss-1' });
    expect(result.flipped).toBe(false);
    expect(tcs.markCollected).not.toHaveBeenCalled();
  });

  it('flips COMPUTED → COLLECTED', async () => {
    const { service, prisma, tcs } = makeService();
    prisma.sellerSettlement.findUnique.mockResolvedValue({
      tcsLedgerId: 'tcs-1',
    });
    prisma.gstTcsSettlementLedger.findUnique.mockResolvedValue({
      status: 'COMPUTED',
    });
    tcs.markCollected.mockResolvedValue({ id: 'tcs-1', status: 'COLLECTED' });
    const result = await service.markCollectedOnPay({ settlementId: 'ss-1' });
    expect(result.flipped).toBe(true);
    expect(result.ledgerId).toBe('tcs-1');
    expect(tcs.markCollected).toHaveBeenCalledWith({
      ledgerId: 'tcs-1',
      settlementId: 'ss-1',
    });
  });
});

describe('SettlementTcsHookService.computeNetPayoutInPaise', () => {
  it('subtracts TCS from total settlement', () => {
    const net = SettlementTcsHookService.computeNetPayoutInPaise({
      // ₹100,000 settlement (= 10_000_000 paise = ₹1 lakh).
      totalSettlementAmountInPaise: 10_000_000n,
      // ₹100 TCS (= 10_000 paise).
      tcsDeductedInPaise: 10_000n,
    });
    expect(net).toBe(9_990_000n);
  });

  it('returns total when no TCS deducted', () => {
    const net = SettlementTcsHookService.computeNetPayoutInPaise({
      totalSettlementAmountInPaise: 50_00_00n,
      tcsDeductedInPaise: 0n,
    });
    expect(net).toBe(50_00_00n);
  });
});
