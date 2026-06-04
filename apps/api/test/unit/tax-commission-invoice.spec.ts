import 'reflect-metadata';
import { CommissionInvoiceService } from '../../src/modules/tax/application/services/commission-invoice.service';

// Phase 159aa — CommissionInvoiceService unit tests. Closes audit B2
// (no commission tax invoice issued) and B3 (non-GSTIN sellers had
// no invoice path).

interface MockPrisma {
  sellerSettlement: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
}

function makeService(opts: {
  settlement?: any;
  cycleSettlements?: any[];
  platformProfile?: any;
  documentNumber?: string;
  sacCode?: string;
} = {}): {
  service: CommissionInvoiceService;
  prisma: MockPrisma;
  documentSequence: any;
  platformGstProfile: any;
  taxConfig: any;
} {
  const prisma: MockPrisma = {
    sellerSettlement: {
      findUnique: jest.fn().mockResolvedValue(opts.settlement ?? null),
      findMany: jest.fn().mockResolvedValue(opts.cycleSettlements ?? []),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: opts.settlement?.id ?? 'st-1',
        ...data,
      })),
    },
  };
  const documentSequence = {
    nextNumber: jest.fn().mockResolvedValue({
      documentNumber: opts.documentNumber ?? 'SM-MKTCOM-000042',
      sequenceKey: 'MKTCOM:GSTIN|2026-27|TAX_INVOICE',
      lastNumber: 42,
      prefix: 'SM-MKTCOM',
      supplierGstin: 'MKTCOM:27AAACR4849R1ZL',
      financialYear: '2026-27',
      documentType: 'TAX_INVOICE',
    }),
  };
  const platformGstProfile = {
    requireDefault: jest.fn().mockResolvedValue(
      opts.platformProfile ?? {
        gstin: '27AAACR4849R1ZL',
        gstStateCode: '27',
        legalBusinessName: 'Sportsmart Marketplace',
        isDefault: true,
        isActive: true,
      },
    ),
  };
  const taxConfig = {
    getString: jest.fn().mockResolvedValue(opts.sacCode ?? '9985'),
  };
  const service = new CommissionInvoiceService(
    prisma as any,
    documentSequence as any,
    platformGstProfile as any,
    taxConfig as any,
  );
  return { service, prisma, documentSequence, platformGstProfile, taxConfig };
}

describe('CommissionInvoiceService.issueForSettlement', () => {
  // Phase 159aa (audit B2) — every commission supply gets a tax invoice.
  it('issues an invoice for a B2B (GSTIN-registered) settlement', async () => {
    const { service, prisma } = makeService({
      settlement: {
        id: 'st-1',
        sellerId: 'sel-1',
        commissionInvoiceNumber: null,
        seller: {
          id: 'sel-1',
          gstin: '29ABCDE1234F1Z5',
          gstStateCode: '29',
          legalBusinessName: 'Acme Sports Pvt Ltd',
          sellerShopName: 'Acme Sports',
        },
        cycle: {
          id: 'cyc-1',
          periodEnd: new Date('2026-04-30T18:30:00Z'),
          approvedAt: new Date('2026-04-30T05:00:00Z'),
        },
      },
    });
    const result = await service.issueForSettlement({ settlementId: 'st-1' });
    expect(result.alreadyIssued).toBe(false);
    expect(result.commissionInvoiceNumber).toBe('SM-MKTCOM-000042');
    expect(result.commissionInvoiceRecipientGstin).toBe('29ABCDE1234F1Z5');
    expect(result.commissionRecipientIsB2c).toBe(false);
    expect(result.commissionInvoiceSupplierGstin).toBe('27AAACR4849R1ZL');
    expect(result.commissionPlaceOfSupplyStateCode).toBe('29');
    expect(prisma.sellerSettlement.update).toHaveBeenCalled();
  });

  // Phase 159aa (audit B3) — non-GSTIN sellers flagged B2C, not dropped.
  it('flags non-GSTIN settlements as B2C with PoS = seller address state (B3)', async () => {
    const { service } = makeService({
      settlement: {
        id: 'st-b2c',
        sellerId: 'sel-b2c',
        commissionInvoiceNumber: null,
        seller: {
          id: 'sel-b2c',
          gstin: null,
          gstStateCode: '07',
          legalBusinessName: null,
          sellerShopName: 'Small Seller',
        },
        cycle: {
          id: 'cyc-1',
          periodEnd: new Date('2026-04-30T18:30:00Z'),
          approvedAt: null,
        },
      },
    });
    const result = await service.issueForSettlement({ settlementId: 'st-b2c' });
    expect(result.commissionRecipientIsB2c).toBe(true);
    expect(result.commissionInvoiceRecipientGstin).toBeNull();
    expect(result.commissionPlaceOfSupplyStateCode).toBe('07');
  });

  it('is idempotent on a settlement that already has an invoice', async () => {
    const { service, documentSequence, prisma } = makeService({
      settlement: {
        id: 'st-prev',
        sellerId: 'sel-1',
        commissionInvoiceNumber: 'SM-MKTCOM-000007',
        commissionInvoiceDate: new Date('2026-04-15T05:30:00Z'),
        commissionInvoiceFilingPeriod: '2026-04',
        commissionInvoiceSupplierGstin: '27AAACR4849R1ZL',
        commissionInvoiceRecipientGstin: '29ABCDE1234F1Z5',
        commissionRecipientIsB2c: false,
        commissionPlaceOfSupplyStateCode: '29',
        commissionInvoiceSacCode: '9985',
        seller: { gstin: '29ABCDE1234F1Z5', gstStateCode: '29' },
        cycle: {
          periodEnd: new Date('2026-04-30T18:30:00Z'),
          approvedAt: new Date('2026-04-30T05:00:00Z'),
        },
      },
    });
    const result = await service.issueForSettlement({ settlementId: 'st-prev' });
    expect(result.alreadyIssued).toBe(true);
    expect(result.commissionInvoiceNumber).toBe('SM-MKTCOM-000007');
    expect(documentSequence.nextNumber).not.toHaveBeenCalled();
    expect(prisma.sellerSettlement.update).not.toHaveBeenCalled();
  });

  it('falls back to "99" Other Territory when seller has no state code', async () => {
    const { service } = makeService({
      settlement: {
        id: 'st-orphan',
        sellerId: 'sel-x',
        commissionInvoiceNumber: null,
        seller: {
          id: 'sel-x',
          gstin: null,
          gstStateCode: null,
          legalBusinessName: null,
          sellerShopName: null,
        },
        cycle: {
          periodEnd: new Date('2026-04-30T18:30:00Z'),
          approvedAt: null,
        },
      },
    });
    const result = await service.issueForSettlement({ settlementId: 'st-orphan' });
    expect(result.commissionPlaceOfSupplyStateCode).toBe('99');
  });
});

describe('CommissionInvoiceService.applyToCycleOnApprove', () => {
  it('issues invoices for every un-issued settlement + skips already-issued ones', async () => {
    const { service, prisma } = makeService({
      cycleSettlements: [
        { id: 's-a', commissionInvoiceNumber: null },
        { id: 's-b', commissionInvoiceNumber: 'SM-MKTCOM-000001' },
        { id: 's-c', commissionInvoiceNumber: null },
      ],
    });
    // findUnique inside issueForSettlement: return a seller-shaped stub
    // for each id so the loop can complete.
    prisma.sellerSettlement.findUnique.mockImplementation(async ({ where }: any) => ({
      id: where.id,
      sellerId: `sel-${where.id}`,
      commissionInvoiceNumber: null,
      seller: { gstin: '29ABCDE1234F1Z5', gstStateCode: '29' },
      cycle: {
        periodEnd: new Date('2026-04-30T18:30:00Z'),
        approvedAt: null,
      },
    }));
    const result = await service.applyToCycleOnApprove({ cycleId: 'cyc-1' });
    expect(result.invoicesIssued).toBe(2);
    expect(result.invoicesSkipped).toBe(1);
    expect(result.invoicesFailed).toBe(0);
  });

  it('isolates per-settlement failures (logs + continues)', async () => {
    const { service, prisma } = makeService({
      cycleSettlements: [
        { id: 's-good', commissionInvoiceNumber: null },
        { id: 's-bad', commissionInvoiceNumber: null },
      ],
    });
    prisma.sellerSettlement.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 's-bad') return null; // triggers "not found" throw
      return {
        id: where.id,
        sellerId: `sel-${where.id}`,
        commissionInvoiceNumber: null,
        seller: { gstin: '29ABCDE1234F1Z5', gstStateCode: '29' },
        cycle: { periodEnd: new Date(), approvedAt: null },
      };
    });
    const result = await service.applyToCycleOnApprove({ cycleId: 'cyc-bad' });
    expect(result.invoicesIssued).toBe(1);
    expect(result.invoicesFailed).toBe(1);
    expect(result.failedSettlementIds).toEqual(['s-bad']);
  });
});
