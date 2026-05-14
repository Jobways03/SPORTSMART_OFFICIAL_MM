import 'reflect-metadata';
import { TcsService } from '../../src/modules/tax/application/services/tcs.service';

// Phase 16 GST — TcsService tests.
//
// Unit-level: prisma + TaxConfig are mocked. DB-side invariants
// (partial unique on (seller, period) active, FK enforcement) live
// in Phase 27 integration tests.

interface MockPrisma {
  gstTcsSettlementLedger: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    findMany: jest.Mock;
  };
  taxDocument: { findMany: jest.Mock };
}

interface MockTaxConfig {
  getNumber: jest.Mock;
}

function makeService(opts: { rateBps?: number } = {}): {
  service: TcsService;
  prisma: MockPrisma;
} {
  const prisma: MockPrisma = {
    gstTcsSettlementLedger: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    taxDocument: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const taxConfig: MockTaxConfig = {
    getNumber: jest.fn().mockResolvedValue(opts.rateBps ?? 100),
  };
  const service = new TcsService(prisma as any, taxConfig as any);
  return { service, prisma };
}

describe('TcsService.filingPeriodOf', () => {
  it('exposes the pure helper', () => {
    expect(TcsService.filingPeriodOf(new Date(Date.UTC(2026, 3, 15)))).toBe(
      '2026-04',
    );
  });
});

describe('TcsService.computeForSeller', () => {
  it('returns existing row idempotently', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findFirst.mockResolvedValue({
      id: 'ledger-1',
      sellerId: 's-1',
      filingPeriod: '2026-04',
      status: 'COMPUTED',
    });
    const result = await service.computeForSeller({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    expect(result.isNew).toBe(false);
    expect(prisma.taxDocument.findMany).not.toHaveBeenCalled();
    expect(prisma.gstTcsSettlementLedger.create).not.toHaveBeenCalled();
  });

  it('aggregates invoices + credit notes into intra/inter split', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findFirst
      .mockResolvedValueOnce(null) // no existing ledger row
      .mockResolvedValueOnce(null); // no prior carry-forward
    prisma.taxDocument.findMany.mockResolvedValue([
      {
        documentType: 'TAX_INVOICE',
        taxableAmountInPaise: 1_000_000n, // ₹10k
        sellerStateCode: '29',
        placeOfSupplyStateCode: '29', // intra
        supplierGstin: '29ABCDE1234F1Z5',
      },
      {
        documentType: 'TAX_INVOICE',
        taxableAmountInPaise: 500_000n, // ₹5k
        sellerStateCode: '29',
        placeOfSupplyStateCode: '07', // inter (KA → DL)
        supplierGstin: '29ABCDE1234F1Z5',
      },
      {
        documentType: 'CREDIT_NOTE',
        taxableAmountInPaise: 200_000n, // ₹2k reversal on intra
        sellerStateCode: '29',
        placeOfSupplyStateCode: '29',
        supplierGstin: '29ABCDE1234F1Z5',
      },
    ]);
    prisma.gstTcsSettlementLedger.create.mockImplementation(async (args: any) => ({
      id: 'ledger-new',
      ...args.data,
    }));

    const r = await service.computeForSeller({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    expect(r.isNew).toBe(true);
    const created = prisma.gstTcsSettlementLedger.create.mock.calls[0][0].data;
    // Intra: 1_000_000 - 200_000 = 800_000. Inter: 500_000.
    // Net: 1_300_000.
    expect(created.intraStateTaxableInPaise).toBe(800_000n);
    expect(created.interStateTaxableInPaise).toBe(500_000n);
    expect(created.netTaxableSupplyInPaise).toBe(1_300_000n);
    expect(created.grossTaxableSupplyInPaise).toBe(1_500_000n);
    expect(created.creditNoteReversalInPaise).toBe(200_000n);
    // TCS: intra 800k × 0.5% × 2 legs = 8000. Inter 500k × 1% = 5000.
    expect(created.cgstTcsInPaise).toBe(4_000n);
    expect(created.sgstTcsInPaise).toBe(4_000n);
    expect(created.igstTcsInPaise).toBe(5_000n);
    expect(created.totalTcsInPaise).toBe(13_000n);
    expect(created.status).toBe('COMPUTED');
    expect(created.supplierGstin).toBe('29ABCDE1234F1Z5');
  });

  it('clamps + emits carry-forward when credit notes exceed invoices', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.taxDocument.findMany.mockResolvedValue([
      {
        documentType: 'TAX_INVOICE',
        taxableAmountInPaise: 100_000n,
        sellerStateCode: '29',
        placeOfSupplyStateCode: '29',
        supplierGstin: '29ABCDE1234F1Z5',
      },
      {
        documentType: 'CREDIT_NOTE',
        taxableAmountInPaise: 300_000n,
        sellerStateCode: '29',
        placeOfSupplyStateCode: '29',
        supplierGstin: '29ABCDE1234F1Z5',
      },
    ]);
    prisma.gstTcsSettlementLedger.create.mockImplementation(async (args: any) => ({
      id: 'ledger-cf',
      ...args.data,
    }));

    await service.computeForSeller({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    const created = prisma.gstTcsSettlementLedger.create.mock.calls[0][0].data;
    expect(created.netTaxableSupplyInPaise).toBe(0n);
    expect(created.adjustmentCarriedForwardInPaise).toBe(200_000n);
    expect(created.totalTcsInPaise).toBe(0n);
  });

  it('consumes prior-period carry-forward', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findFirst
      .mockResolvedValueOnce(null) // no existing for current period
      .mockResolvedValueOnce({
        // prior period (2026-03) had 50k carry-forward
        adjustmentCarriedForwardInPaise: 50_000n,
      });
    prisma.taxDocument.findMany.mockResolvedValue([
      {
        documentType: 'TAX_INVOICE',
        taxableAmountInPaise: 1_000_000n,
        sellerStateCode: '29',
        placeOfSupplyStateCode: '29',
        supplierGstin: '29ABCDE1234F1Z5',
      },
    ]);
    prisma.gstTcsSettlementLedger.create.mockImplementation(async (args: any) => ({
      id: 'ledger-x',
      ...args.data,
    }));

    await service.computeForSeller({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    const created = prisma.gstTcsSettlementLedger.create.mock.calls[0][0].data;
    // 1_000_000 - 0 - 50_000 = 950_000 net.
    expect(created.netTaxableSupplyInPaise).toBe(950_000n);
  });

  it('treats missing state codes as inter-state (conservative)', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.taxDocument.findMany.mockResolvedValue([
      {
        documentType: 'TAX_INVOICE',
        taxableAmountInPaise: 1_000_000n,
        sellerStateCode: null,
        placeOfSupplyStateCode: '29',
        supplierGstin: null,
      },
    ]);
    prisma.gstTcsSettlementLedger.create.mockImplementation(async (args: any) => ({
      id: 'ledger-cnv',
      ...args.data,
    }));

    await service.computeForSeller({
      sellerId: 's-1',
      filingPeriod: '2026-04',
    });
    const created = prisma.gstTcsSettlementLedger.create.mock.calls[0][0].data;
    expect(created.intraStateTaxableInPaise).toBe(0n);
    expect(created.interStateTaxableInPaise).toBe(1_000_000n);
    expect(created.igstTcsInPaise).toBe(10_000n);
  });
});

describe('TcsService.markCollected', () => {
  it('throws on unknown id', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findUnique.mockResolvedValue(null);
    await expect(
      service.markCollected({ ledgerId: 'nope', settlementId: 'st-1' }),
    ).rejects.toThrow(/not found/);
  });

  it('is idempotent on COLLECTED', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findUnique.mockResolvedValue({
      id: 'l-1',
      status: 'COLLECTED',
    });
    const r = await service.markCollected({
      ledgerId: 'l-1',
      settlementId: 'st-1',
    });
    expect(prisma.gstTcsSettlementLedger.update).not.toHaveBeenCalled();
    expect(r.status).toBe('COLLECTED');
  });

  it('refuses non-COMPUTED transitions', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findUnique.mockResolvedValue({
      id: 'l-2',
      status: 'FILED',
    });
    await expect(
      service.markCollected({ ledgerId: 'l-2', settlementId: 'st-1' }),
    ).rejects.toThrow(/cannot transition FILED → COLLECTED/);
  });

  it('flips COMPUTED → COLLECTED + stamps settlement', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findUnique.mockResolvedValue({
      id: 'l-3',
      status: 'COMPUTED',
    });
    prisma.gstTcsSettlementLedger.update.mockImplementation(
      async (args: any) => ({
        id: 'l-3',
        status: 'COLLECTED',
        settlementId: 'st-1',
        ...args.data,
      }),
    );
    const r = await service.markCollected({
      ledgerId: 'l-3',
      settlementId: 'st-1',
    });
    expect(r.status).toBe('COLLECTED');
    expect(r.settlementId).toBe('st-1');
    expect(r.collectedAt).toBeInstanceOf(Date);
  });
});

describe('TcsService.markFiled', () => {
  it('returns 0 on empty input', async () => {
    const { service, prisma } = makeService();
    const n = await service.markFiled({ ledgerIds: [], filedBy: 'admin-1' });
    expect(n).toBe(0);
    expect(prisma.gstTcsSettlementLedger.updateMany).not.toHaveBeenCalled();
  });

  it('only flips COLLECTED rows', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.updateMany.mockResolvedValue({ count: 2 });
    const n = await service.markFiled({
      ledgerIds: ['l-1', 'l-2', 'l-3'],
      filedBy: 'admin-1',
    });
    expect(n).toBe(2);
    const where =
      prisma.gstTcsSettlementLedger.updateMany.mock.calls[0][0].where;
    expect(where.status).toBe('COLLECTED');
  });
});

describe('TcsService.markPaidToGovt', () => {
  it('only flips FILED rows', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.updateMany.mockResolvedValue({ count: 1 });
    const n = await service.markPaidToGovt({
      ledgerIds: ['l-1'],
      paidBy: 'admin-1',
      paymentReference: 'BANK-REF-9999',
    });
    expect(n).toBe(1);
    const args = prisma.gstTcsSettlementLedger.updateMany.mock.calls[0][0];
    expect(args.where.status).toBe('FILED');
    expect(args.data.paymentReference).toBe('BANK-REF-9999');
  });
});

describe('TcsService.reverse', () => {
  it('throws on unknown id', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findUnique.mockResolvedValue(null);
    await expect(
      service.reverse({
        ledgerId: 'nope',
        reversedBy: 'admin-1',
        reason: 'r',
      }),
    ).rejects.toThrow(/not found/);
  });

  it('is idempotent on REVERSED', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findUnique.mockResolvedValue({
      id: 'l-r',
      status: 'REVERSED',
    });
    const r = await service.reverse({
      ledgerId: 'l-r',
      reversedBy: 'admin-1',
      reason: 'duplicate',
    });
    expect(prisma.gstTcsSettlementLedger.update).not.toHaveBeenCalled();
    expect(r.status).toBe('REVERSED');
  });

  it('flips to REVERSED + preserves reason in computedReason', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findUnique.mockResolvedValue({
      id: 'l-x',
      status: 'FILED',
      computedReason: 'auto-compute 2026-04',
    });
    prisma.gstTcsSettlementLedger.update.mockImplementation(
      async (args: any) => ({
        id: 'l-x',
        status: 'REVERSED',
        ...args.data,
      }),
    );
    const r = await service.reverse({
      ledgerId: 'l-x',
      reversedBy: 'admin-2',
      reason: 'finance correction',
    });
    expect(r.status).toBe('REVERSED');
    expect(r.computedReason).toMatch(/finance correction/);
    expect(r.computedReason).toMatch(/auto-compute 2026-04/);
  });
});
