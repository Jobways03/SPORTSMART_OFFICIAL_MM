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
  };
  const tcs: MockTcs = {
    computeForSeller: jest.fn(),
    markCollected: jest.fn(),
  };
  const service = new SettlementTcsHookService(prisma as any, tcs as any);
  return { service, prisma, tcs };
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

    const result = await service.applyToCycleOnApprove({ cycleId: 'cyc-1' });
    expect(result.settlementsProcessed).toBe(2);
    expect(result.settlementsSkipped).toBe(0);
    expect(result.totalTcsDeductedInPaise).toBe(30_000n);
    expect(result.filingPeriod).toBe('2026-04');
    expect(prisma.sellerSettlement.update).toHaveBeenCalledTimes(2);
    const first = prisma.sellerSettlement.update.mock.calls[0][0];
    expect(first.data).toMatchObject({
      tcsLedgerId: 'tcs-1',
      tcsDeductedInPaise: 10_000n,
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

    const result = await service.applyToCycleOnApprove({ cycleId: 'cyc-3' });
    expect(result.settlementsProcessed).toBe(1);
    expect(result.settlementsSkipped).toBe(0);
    expect(result.totalTcsDeductedInPaise).toBe(5_000n);
  });

  it('uses the cycle periodEnd to derive filing period', async () => {
    const { service, prisma, tcs } = makeService();
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
