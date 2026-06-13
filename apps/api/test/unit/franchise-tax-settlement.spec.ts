import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { SettlementTds194OHookService } from '../../src/modules/tax/application/services/settlement-tds-194o-hook.service';
import { SettlementTcsHookService } from '../../src/modules/tax/application/services/settlement-tcs-hook.service';
import { FranchiseSettlementService } from '../../src/modules/franchise/application/services/franchise-settlement.service';

// Phase 250 (Franchise tax) — franchise §194-O TDS hook + the markSettlementPaid
// net-of-tax payout. prisma + Tds194OService are mocked.

const D = (n: number | string) => new Prisma.Decimal(n);

// ── TDS hook (franchise methods) ────────────────────────────────────────────

interface MockPrisma {
  franchiseSettlement: { findUnique: jest.Mock; update: jest.Mock };
  section194OTdsLedger: { findUnique: jest.Mock };
}
interface MockTds {
  computeForFranchise: jest.Mock;
  markWithheld: jest.Mock;
}

function makeHook(): { hook: SettlementTds194OHookService; prisma: MockPrisma; tds: MockTds } {
  const prisma: MockPrisma = {
    franchiseSettlement: { findUnique: jest.fn(), update: jest.fn() },
    section194OTdsLedger: { findUnique: jest.fn() },
  };
  const tds: MockTds = { computeForFranchise: jest.fn(), markWithheld: jest.fn() };
  // Phase 252 — TDS slice reads the configured base; default to product (PGS).
  const taxConfig = {
    getSettlementTaxConfig: jest.fn().mockResolvedValue({
      gst: { rateBps: 1800, baseType: 'COMMISSION' },
      tcs: { rateBps: 100, baseType: 'PRICE_OF_GOODS_SOLD' },
      tds: { rateBps: 100, baseType: 'PRICE_OF_GOODS_SOLD' },
    }),
  };
  const hook = new SettlementTds194OHookService(
    prisma as any,
    tds as any,
    taxConfig as any,
  );
  return { hook, prisma, tds };
}

describe('SettlementTds194OHookService.applyToFranchiseSettlementOnApprove', () => {
  it('stamps the PER-SETTLEMENT slice, not the whole-quarter ledger total (1% w/ PAN)', async () => {
    const { hook, prisma, tds } = makeHook();
    // settlement meta read (apply) + amounts read (computeFranchiseSettlementTds).
    prisma.franchiseSettlement.findUnique.mockResolvedValue({
      id: 'fs-1',
      franchiseId: 'fr-1',
      tdsLedgerId: null,
      cycle: { periodEnd: new Date(Date.UTC(2026, 9, 15)) }, // FY26 Q3
      totalOnlineAmount: D(4000), // ₹4,000 online gross
      reversalAmount: D(0),
    });
    // Quarterly ledger total is ₹999.99 (irrelevant) — must NOT be stamped.
    tds.computeForFranchise.mockResolvedValue({
      ledger: { id: 'tds-q3', tdsInPaise: 99_999n, tdsRateBps: 100 },
      isNew: true,
      skipped: false,
    });
    prisma.franchiseSettlement.update.mockResolvedValue({});

    const r = await hook.applyToFranchiseSettlementOnApprove({ settlementId: 'fs-1' });

    expect(r.stamped).toBe(true);
    // 1% of ₹4,000 = ₹40 = 4_000 paise — the slice, NOT the 99_999 quarterly total.
    expect(r.tdsInPaise).toBe(4_000n);
    const data = prisma.franchiseSettlement.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tdsLedgerId: 'tds-q3',
      tdsDeductedInPaise: 4_000n,
      tdsRateBpsSnapshot: 100,
      tdsFilingPeriod: '2026-Q3',
    });
  });

  it('applies the 5% (no-PAN) rate from the ledger snapshot to the slice', async () => {
    const { hook, prisma, tds } = makeHook();
    prisma.franchiseSettlement.findUnique.mockResolvedValue({
      id: 'fs-2',
      franchiseId: 'fr-2',
      tdsLedgerId: null,
      cycle: { periodEnd: new Date(Date.UTC(2026, 9, 15)) },
      totalOnlineAmount: D(4000),
      reversalAmount: D(0),
    });
    tds.computeForFranchise.mockResolvedValue({
      ledger: { id: 'tds-np', tdsInPaise: 1n, tdsRateBps: 500 },
      isNew: true,
      skipped: false,
    });
    prisma.franchiseSettlement.update.mockResolvedValue({});
    const r = await hook.applyToFranchiseSettlementOnApprove({ settlementId: 'fs-2' });
    // 5% of ₹4,000 = ₹200 = 20_000 paise.
    expect(r.tdsInPaise).toBe(20_000n);
  });

  it('nets the settlement’s own reversals and clamps the slice at zero', async () => {
    const { hook, prisma, tds } = makeHook();
    prisma.franchiseSettlement.findUnique.mockResolvedValue({
      id: 'fs-3',
      franchiseId: 'fr-3',
      tdsLedgerId: null,
      cycle: { periodEnd: new Date(Date.UTC(2026, 9, 15)) },
      totalOnlineAmount: D(1000),
      reversalAmount: D(1500), // returns exceed gross → clamp 0
    });
    tds.computeForFranchise.mockResolvedValue({
      ledger: { id: 'tds-neg', tdsInPaise: 0n, tdsRateBps: 100 },
      isNew: true,
      skipped: false,
    });
    prisma.franchiseSettlement.update.mockResolvedValue({});
    const r = await hook.applyToFranchiseSettlementOnApprove({ settlementId: 'fs-3' });
    expect(r.tdsInPaise).toBe(0n);
  });

  it('is idempotent — skips a settlement that already carries a tdsLedgerId', async () => {
    const { hook, prisma, tds } = makeHook();
    prisma.franchiseSettlement.findUnique.mockResolvedValue({
      id: 'fs-4',
      franchiseId: 'fr-4',
      tdsLedgerId: 'tds-existing',
      cycle: { periodEnd: new Date(Date.UTC(2026, 9, 15)) },
    });
    const r = await hook.applyToFranchiseSettlementOnApprove({ settlementId: 'fs-4' });
    expect(r.skipped).toBe(true);
    expect(tds.computeForFranchise).not.toHaveBeenCalled();
    expect(prisma.franchiseSettlement.update).not.toHaveBeenCalled();
  });

  it('records a skip reason (and no ledger) when the franchise has no quarter activity', async () => {
    const { hook, prisma, tds } = makeHook();
    prisma.franchiseSettlement.findUnique.mockResolvedValue({
      id: 'fs-5',
      franchiseId: 'fr-5',
      tdsLedgerId: null,
      cycle: { periodEnd: new Date(Date.UTC(2026, 9, 15)) },
    });
    tds.computeForFranchise.mockResolvedValue({
      ledger: null,
      skipped: true,
      skipReason: 'NO_ACTIVITY',
    });
    prisma.franchiseSettlement.update.mockResolvedValue({});
    const r = await hook.applyToFranchiseSettlementOnApprove({ settlementId: 'fs-5' });
    expect(r.skipped).toBe(true);
    expect(prisma.franchiseSettlement.update).toHaveBeenCalledWith({
      where: { id: 'fs-5' },
      data: { tdsSkipReason: 'NO_ACTIVITY' },
    });
  });
});

describe('SettlementTds194OHookService.markWithheldOnPayFranchise', () => {
  it('flips the franchise TDS ledger COMPUTED → WITHHELD', async () => {
    const { hook, prisma, tds } = makeHook();
    prisma.franchiseSettlement.findUnique.mockResolvedValue({ tdsLedgerId: 'tds-1' });
    prisma.section194OTdsLedger.findUnique.mockResolvedValue({ status: 'COMPUTED' });
    tds.markWithheld.mockResolvedValue({ id: 'tds-1', status: 'WITHHELD' });
    const r = await hook.markWithheldOnPayFranchise({ settlementId: 'fs-1' });
    expect(r.flipped).toBe(true);
    expect(tds.markWithheld).toHaveBeenCalledWith({ ledgerId: 'tds-1', settlementId: 'fs-1' });
  });

  it('no-ops when the settlement has no TDS ledger', async () => {
    const { hook, prisma, tds } = makeHook();
    prisma.franchiseSettlement.findUnique.mockResolvedValue({ tdsLedgerId: null });
    const r = await hook.markWithheldOnPayFranchise({ settlementId: 'fs-1' });
    expect(r.flipped).toBe(false);
    expect(tds.markWithheld).not.toHaveBeenCalled();
  });
});

// ── markSettlementPaid net-of-tax payout ────────────────────────────────────

describe('FranchiseSettlementService.markSettlementPaid — net-of-tax paidAmountInPaise', () => {
  it('wires net = netPayable − commissionGST − TCS − TDS and records paidAmountInPaise', async () => {
    let flipData: any = null;
    const tx: any = {
      franchiseSettlement: {
        updateMany: jest.fn(async (args: any) => {
          flipData = args.data;
          return { count: 1 };
        }),
        findUnique: jest.fn().mockResolvedValue({ id: 'fs-1', status: 'PAID' }),
      },
      franchiseFinanceLedger: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma: any = { $transaction: (cb: any) => cb(tx) };
    const financeRepo: any = {
      findSettlementById: jest.fn().mockResolvedValue({
        id: 'fs-1',
        status: 'APPROVED',
        franchiseId: 'fr-1',
        netPayableToFranchise: D(1000), // ₹1,000 = 100_000 paise
        totalCommissionGstInPaise: 18_000n, // ₹180
        tcsDeductedInPaise: 5_000n, // ₹50
        tdsDeductedInPaise: 5_000n, // ₹50
        ledgerEntries: [{ id: 'e1' }],
      }),
    };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const logger: any = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
    const tdsHook: any = {
      markWithheldOnPayFranchise: jest
        .fn()
        .mockResolvedValue({ ledgerId: 'tds-1', flipped: true }),
    };
    const tcsHook: any = {
      markCollectedOnPayFranchise: jest
        .fn()
        .mockResolvedValue({ ledgerId: 'tcs-1', flipped: true }),
    };
    const svc = new FranchiseSettlementService(
      financeRepo,
      {} as any,
      eventBus,
      logger,
      prisma,
      tdsHook,
      tcsHook,
    );

    await svc.markSettlementPaid('fs-1', 'UTR-FR-12345');

    // 100_000 − 18_000 − 5_000 − 5_000 = 72_000 paise (₹720).
    expect(flipData.paidAmountInPaise).toBe(72_000n);
    expect(flipData.status).toBe('PAID');
    expect(tdsHook.markWithheldOnPayFranchise).toHaveBeenCalledWith({ settlementId: 'fs-1' });
  });

  it('floors paidAmountInPaise at zero when withheld taxes exceed the net', async () => {
    let flipData: any = null;
    const tx: any = {
      franchiseSettlement: {
        updateMany: jest.fn(async (args: any) => {
          flipData = args.data;
          return { count: 1 };
        }),
        findUnique: jest.fn().mockResolvedValue({ id: 'fs-2', status: 'PAID' }),
      },
      franchiseFinanceLedger: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma: any = { $transaction: (cb: any) => cb(tx) };
    const financeRepo: any = {
      findSettlementById: jest.fn().mockResolvedValue({
        id: 'fs-2',
        status: 'APPROVED',
        franchiseId: 'fr-2',
        netPayableToFranchise: D(100), // ₹100 = 10_000 paise
        totalCommissionGstInPaise: 9_000n,
        tcsDeductedInPaise: 5_000n,
        tdsDeductedInPaise: 5_000n, // total withheld 19_000 > 10_000
        ledgerEntries: [],
      }),
    };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const logger: any = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
    const tdsHook: any = {
      markWithheldOnPayFranchise: jest.fn().mockResolvedValue({ flipped: false }),
    };
    const tcsHook: any = {
      markCollectedOnPayFranchise: jest.fn().mockResolvedValue({ flipped: false }),
    };
    const svc = new FranchiseSettlementService(
      financeRepo,
      {} as any,
      eventBus,
      logger,
      prisma,
      tdsHook,
      tcsHook,
    );

    await svc.markSettlementPaid('fs-2', 'UTR-FR-67890');
    expect(flipData.paidAmountInPaise).toBe(0n);
  });
});

// ── TCS hook (franchise methods) ────────────────────────────────────────────

interface MockTcsPrisma {
  franchiseSettlement: { findUnique: jest.Mock; update: jest.Mock };
  franchiseFinanceLedger: { findMany: jest.Mock };
  taxDocument: { findMany: jest.Mock };
  gstTcsSettlementLedger: { findUnique: jest.Mock };
}
interface MockTcs {
  computeForFranchise: jest.Mock;
  markCollected: jest.Mock;
}
function makeTcsHook(): {
  hook: SettlementTcsHookService;
  prisma: MockTcsPrisma;
  tcs: MockTcs;
} {
  const prisma: MockTcsPrisma = {
    franchiseSettlement: { findUnique: jest.fn(), update: jest.fn() },
    franchiseFinanceLedger: { findMany: jest.fn() },
    taxDocument: { findMany: jest.fn() },
    gstTcsSettlementLedger: { findUnique: jest.fn() },
  };
  const tcs: MockTcs = { computeForFranchise: jest.fn(), markCollected: jest.fn() };
  // Phase 252 — TCS hook now takes TaxConfigService (franchise TCS slice is
  // unchanged/statutory, so a default stub suffices here).
  const taxConfig = {
    getSettlementTaxConfig: jest.fn().mockResolvedValue({
      gst: { rateBps: 1800, baseType: 'COMMISSION' },
      tcs: { rateBps: 100, baseType: 'GST' },
      tds: { rateBps: 100, baseType: 'COMMISSION' },
    }),
  };
  const hook = new SettlementTcsHookService(
    prisma as any,
    tcs as any,
    taxConfig as any,
  );
  return { hook, prisma, tcs };
}

describe('SettlementTcsHookService.applyToFranchiseSettlementOnApprove', () => {
  it('stamps the PER-SETTLEMENT TCS slice from the settlement’s own online invoices', async () => {
    const { hook, prisma, tcs } = makeTcsHook();
    prisma.franchiseSettlement.findUnique.mockResolvedValue({
      id: 'fs-1',
      franchiseId: 'fr-1',
      tcsLedgerId: null,
      cycle: { periodEnd: new Date(Date.UTC(2026, 3, 30)) }, // April 2026
    });
    tcs.computeForFranchise.mockResolvedValue({
      ledger: { id: 'tcs-apr', tcsRateBps: 100 },
      isNew: true,
    });
    // The settlement's ONLINE_ORDER ledger entries → their sub-order ids.
    prisma.franchiseFinanceLedger.findMany.mockResolvedValue([
      { sourceId: 'so-1' },
      { sourceId: 'so-2' },
    ]);
    // Tax invoices for those sub-orders: ₹8,000 ex-GST taxable supply.
    prisma.taxDocument.findMany.mockResolvedValue([
      { documentType: 'TAX_INVOICE', taxableAmountInPaise: 800_000n },
    ]);
    prisma.franchiseSettlement.update.mockResolvedValue({});

    const r = await hook.applyToFranchiseSettlementOnApprove({ settlementId: 'fs-1' });
    expect(r.stamped).toBe(true);
    // 1% of ₹8,000 = ₹80 = 8_000 paise.
    expect(r.tcsInPaise).toBe(8_000n);
    expect(prisma.franchiseSettlement.update.mock.calls[0][0].data).toMatchObject({
      tcsLedgerId: 'tcs-apr',
      tcsDeductedInPaise: 8_000n,
      tcsRateBpsSnapshot: 100,
      tcsFilingPeriod: '2026-04',
    });
  });

  it('subtracts credit notes from the slice taxable base', async () => {
    const { hook, prisma, tcs } = makeTcsHook();
    prisma.franchiseSettlement.findUnique.mockResolvedValue({
      id: 'fs-cn',
      franchiseId: 'fr-1',
      tcsLedgerId: null,
      cycle: { periodEnd: new Date(Date.UTC(2026, 3, 30)) },
    });
    tcs.computeForFranchise.mockResolvedValue({
      ledger: { id: 'tcs-apr', tcsRateBps: 100 },
      isNew: true,
    });
    prisma.franchiseFinanceLedger.findMany.mockResolvedValue([{ sourceId: 'so-1' }]);
    prisma.taxDocument.findMany.mockResolvedValue([
      { documentType: 'TAX_INVOICE', taxableAmountInPaise: 800_000n },
      { documentType: 'CREDIT_NOTE', taxableAmountInPaise: 300_000n }, // ₹3,000 returned
    ]);
    prisma.franchiseSettlement.update.mockResolvedValue({});
    const r = await hook.applyToFranchiseSettlementOnApprove({ settlementId: 'fs-cn' });
    // 1% of (₹8,000 − ₹3,000) = ₹50 = 5_000 paise.
    expect(r.tcsInPaise).toBe(5_000n);
  });

  it('is idempotent — skips a settlement already carrying a tcsLedgerId', async () => {
    const { hook, prisma, tcs } = makeTcsHook();
    prisma.franchiseSettlement.findUnique.mockResolvedValue({
      id: 'fs-2',
      franchiseId: 'fr-1',
      tcsLedgerId: 'tcs-existing',
      cycle: { periodEnd: new Date(Date.UTC(2026, 3, 30)) },
    });
    const r = await hook.applyToFranchiseSettlementOnApprove({ settlementId: 'fs-2' });
    expect(r.skipped).toBe(true);
    expect(tcs.computeForFranchise).not.toHaveBeenCalled();
  });
});

describe('SettlementTcsHookService.markCollectedOnPayFranchise', () => {
  it('flips the franchise TCS ledger COMPUTED → COLLECTED', async () => {
    const { hook, prisma, tcs } = makeTcsHook();
    prisma.franchiseSettlement.findUnique.mockResolvedValue({ tcsLedgerId: 'tcs-1' });
    prisma.gstTcsSettlementLedger.findUnique.mockResolvedValue({ status: 'COMPUTED' });
    tcs.markCollected.mockResolvedValue({ id: 'tcs-1', status: 'COLLECTED' });
    const r = await hook.markCollectedOnPayFranchise({ settlementId: 'fs-1' });
    expect(r.flipped).toBe(true);
    expect(tcs.markCollected).toHaveBeenCalledWith({ ledgerId: 'tcs-1', settlementId: 'fs-1' });
  });
});
