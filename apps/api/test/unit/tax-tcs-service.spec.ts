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
    groupBy: jest.Mock;
    aggregate: jest.Mock;
  };
  // Phase 160 — append-only lifecycle event log + helpers used by the
  // new methods (certificate render reads the platform profile; bulk
  // collect wraps per-row updates in $transaction).
  gstTcsLedgerEvent: { create: jest.Mock; findMany: jest.Mock };
  platformGstProfile: { findFirst: jest.Mock };
  taxDocument: { findMany: jest.Mock };
  $transaction: jest.Mock;
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
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: {}, _count: { _all: 0 } }),
    },
    gstTcsLedgerEvent: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    platformGstProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    taxDocument: { findMany: jest.fn().mockResolvedValue([]) },
    // Execute the array of PrismaPromises (they're just resolved mocks).
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const taxConfig: MockTaxConfig = {
    getNumber: jest.fn().mockResolvedValue(opts.rateBps ?? 100),
  };
  // Phase 159z — TcsService now resolves PoS state names at compute
  // time so the breakdown JSON column carries human-readable PoS labels.
  // We stub the lookup with the codes we exercise below.
  const placeOfSupply = {
    getStateCodeToNameMap: jest
      .fn()
      .mockResolvedValue(
        new Map<string, string>([
          ['29', 'Karnataka'],
          ['07', 'Delhi'],
          ['27', 'Maharashtra'],
        ]),
      ),
  };
  const service = new TcsService(
    prisma as any,
    taxConfig as any,
    placeOfSupply as any,
  );
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
  it('returns flippedCount=0 / flippedIds=[] on empty input', async () => {
    const { service, prisma } = makeService();
    const r = await service.markFiled({
      ledgerIds: [],
      filedBy: 'admin-1',
      nicArn: 'AA1234567890123',
    });
    expect(r).toEqual({ flippedCount: 0, flippedIds: [], skipped: [] });
    expect(prisma.gstTcsSettlementLedger.updateMany).not.toHaveBeenCalled();
  });

  // Phase 159z (audit #6) — ARN is mandatory; the service refuses to
  // file without one regardless of caller (DTO validation is the first
  // line of defence; this is the second).
  it('refuses to file when nicArn is empty', async () => {
    const { service } = makeService();
    await expect(
      service.markFiled({
        ledgerIds: ['l-1'],
        filedBy: 'admin-1',
        nicArn: '   ',
      }),
    ).rejects.toThrow(/requires a non-empty nicArn/);
  });

  it('only flips COLLECTED rows + persists ARN + returns ids + skipped', async () => {
    const { service, prisma } = makeService();
    // Phase 160 — partitionByStatus selects {id,status} across ALL
    // requested ids; l-3 is in the wrong state so it lands in skipped.
    prisma.gstTcsSettlementLedger.findMany.mockResolvedValue([
      { id: 'l-1', status: 'COLLECTED' },
      { id: 'l-2', status: 'COLLECTED' },
      { id: 'l-3', status: 'COMPUTED' },
    ]);
    prisma.gstTcsSettlementLedger.updateMany.mockResolvedValue({ count: 2 });
    const r = await service.markFiled({
      ledgerIds: ['l-1', 'l-2', 'l-3'],
      filedBy: 'admin-1',
      nicArn: 'AA1234567890123',
    });
    expect(r.flippedCount).toBe(2);
    expect(r.flippedIds).toEqual(['l-1', 'l-2']);
    // Phase 160 (audit B4 / #4) — the straggler is reported with its status.
    expect(r.skipped).toEqual([
      { ledgerId: 'l-3', currentStatus: 'COMPUTED' },
    ]);
    const args = prisma.gstTcsSettlementLedger.updateMany.mock.calls[0][0];
    expect(args.where.status).toBe('COLLECTED');
    expect(args.data.nicArn).toBe('AA1234567890123');
    expect(args.data.status).toBe('FILED');
    // Phase 160 (audit #6) — one FILED lifecycle event per flipped row.
    expect(prisma.gstTcsLedgerEvent.create).toHaveBeenCalledTimes(2);
  });

  it('reports NOT_FOUND for ids that do not exist', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findMany.mockResolvedValue([]);
    const r = await service.markFiled({
      ledgerIds: ['ghost'],
      filedBy: 'admin-1',
      nicArn: 'AA1234567890123',
    });
    expect(r.flippedCount).toBe(0);
    expect(r.skipped).toEqual([
      { ledgerId: 'ghost', currentStatus: 'NOT_FOUND' },
    ]);
  });

  // Phase 160 (review fix) — when a row leaves COLLECTED between the
  // partition SELECT and the CAS updateMany, flippedIds must NOT overclaim.
  it('reconciles the exact flipped set when updateMany count < eligible (race)', async () => {
    const { service, prisma } = makeService();
    // 1st findMany = partitionByStatus: both eligible.
    prisma.gstTcsSettlementLedger.findMany
      .mockResolvedValueOnce([
        { id: 'l-1', status: 'COLLECTED' },
        { id: 'l-2', status: 'COLLECTED' },
      ])
      // 2nd findMany = reconcileFlipped: only l-1 carries this call's stamp.
      .mockResolvedValueOnce([{ id: 'l-1' }]);
    prisma.gstTcsSettlementLedger.updateMany.mockResolvedValue({ count: 1 });
    const r = await service.markFiled({
      ledgerIds: ['l-1', 'l-2'],
      filedBy: 'admin-1',
      nicArn: 'AA1234567890123',
    });
    expect(r.flippedCount).toBe(1);
    expect(r.flippedIds).toEqual(['l-1']);
    // l-2 raced out → reported skipped, not falsely flipped.
    expect(r.skipped).toEqual([{ ledgerId: 'l-2', currentStatus: 'NOT_FOUND' }]);
    // and only ONE event written (no false event for l-2).
    expect(prisma.gstTcsLedgerEvent.create).toHaveBeenCalledTimes(1);
  });
});

describe('TcsService.markPaidToGovt', () => {
  it('only flips FILED rows + returns flippedIds + persists proof file', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findMany.mockResolvedValue([
      { id: 'l-1', status: 'FILED' },
    ]);
    prisma.gstTcsSettlementLedger.updateMany.mockResolvedValue({ count: 1 });
    const r = await service.markPaidToGovt({
      ledgerIds: ['l-1'],
      paidBy: 'admin-1',
      paymentReference: 'BANK-REF-9999',
      paymentProofFileId: 'file-77',
    });
    expect(r.flippedCount).toBe(1);
    expect(r.flippedIds).toEqual(['l-1']);
    expect(r.skipped).toEqual([]);
    const args = prisma.gstTcsSettlementLedger.updateMany.mock.calls[0][0];
    expect(args.where.status).toBe('FILED');
    expect(args.data.paymentReference).toBe('BANK-REF-9999');
    // Phase 160 (audit #11) — proof file persisted on the row.
    expect(args.data.paymentProofFileId).toBe('file-77');
  });
});

// Phase 160 (§52 lifecycle audit B1 / #12) — certificate issuance.
describe('TcsService.markCertificatesIssued', () => {
  it('flips PAID_TO_GOVT → CERTIFICATE_ISSUED with a per-row cert number', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findMany.mockResolvedValue([
      {
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        status: 'PAID_TO_GOVT',
        filingPeriod: '2026-04',
        certificateNumber: null,
      },
      { id: 'l-2', status: 'FILED', filingPeriod: '2026-04', certificateNumber: null },
    ]);
    prisma.gstTcsSettlementLedger.updateMany.mockResolvedValue({ count: 1 });
    const r = await service.markCertificatesIssued({
      ledgerIds: ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'l-2'],
      issuedBy: 'admin-9',
    });
    expect(r.flippedCount).toBe(1);
    expect(r.flippedIds).toEqual(['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']);
    // Per-row number, derived from prefix + period + ledger id.
    expect(r.certificateNumbers['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']).toBe(
      'TCS/2026-04/AAAAAAAA',
    );
    // l-2 wasn't PAID_TO_GOVT → reported as skipped with its status.
    expect(r.skipped).toEqual([{ ledgerId: 'l-2', currentStatus: 'FILED' }]);
    const upd = prisma.gstTcsSettlementLedger.updateMany.mock.calls[0][0];
    expect(upd.where.status).toBe('PAID_TO_GOVT');
    expect(upd.data.status).toBe('CERTIFICATE_ISSUED');
    expect(prisma.gstTcsLedgerEvent.create).toHaveBeenCalledTimes(1);
  });

  it('honours a custom certificate-number prefix', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findMany.mockResolvedValue([
      { id: 'abcdef12-0000-0000-0000-000000000000', status: 'PAID_TO_GOVT', filingPeriod: '2026-05', certificateNumber: null },
    ]);
    prisma.gstTcsSettlementLedger.updateMany.mockResolvedValue({ count: 1 });
    const r = await service.markCertificatesIssued({
      ledgerIds: ['abcdef12-0000-0000-0000-000000000000'],
      issuedBy: 'admin-9',
      certificateNumberPrefix: 'sm-tcs!!',
    });
    // Prefix sanitised to alphanumeric + uppercased.
    expect(
      r.certificateNumbers['abcdef12-0000-0000-0000-000000000000'],
    ).toBe('SMTCS/2026-05/ABCDEF12');
  });
});

// Phase 160 (§52 lifecycle audit #17) — bulk collect.
describe('TcsService.markCollectedBulk', () => {
  it('flips only COMPUTED rows + reports skipped, one tx', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findMany.mockResolvedValue([
      { id: 'l-1', status: 'COMPUTED' },
      { id: 'l-2', status: 'COLLECTED' },
    ]);
    prisma.gstTcsSettlementLedger.updateMany.mockReturnValue(
      Promise.resolve({ count: 1 }),
    );
    const r = await service.markCollectedBulk({
      pairs: [
        { ledgerId: 'l-1', settlementId: 'st-1' },
        { ledgerId: 'l-2', settlementId: 'st-2' },
      ],
    });
    expect(r.flippedCount).toBe(1);
    expect(r.flippedIds).toEqual(['l-1']);
    expect(r.skipped).toEqual([{ ledgerId: 'l-2', currentStatus: 'COLLECTED' }]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

// Phase 160 (§52 lifecycle audit B1) — certificate HTML render.
describe('TcsService.renderCertificateHtml', () => {
  it('returns null when the ledger row is missing', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findUnique.mockResolvedValue(null);
    expect(await service.renderCertificateHtml('nope')).toBeNull();
  });

  it('renders an issued-certificate HTML with the cert number', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findUnique.mockResolvedValue({
      id: 'l-1',
      filingPeriod: '2026-04',
      status: 'CERTIFICATE_ISSUED',
      supplierGstin: '29ABCDE1234F1Z5',
      grossTaxableSupplyInPaise: 1_000_000n,
      netTaxableSupplyInPaise: 1_000_000n,
      cgstTcsInPaise: 5_000n,
      sgstTcsInPaise: 5_000n,
      igstTcsInPaise: 0n,
      totalTcsInPaise: 10_000n,
      tcsRateBps: 100,
      nicArn: 'AA1234567890123',
      paymentReference: 'CIN-123',
      certificateNumber: 'TCS/2026-04/ABC',
      certificateIssuedAt: new Date('2026-05-02T00:00:00Z'),
      seller: { sellerShopName: 'Acme Sports', sellerName: 'Acme', legalBusinessName: 'Acme Pvt Ltd' },
    });
    prisma.platformGstProfile.findFirst.mockResolvedValue({
      legalBusinessName: 'Sportsmart',
      gstin: '27AAACR4849R1ZL',
      registeredAddressJson: { line1: '1 Road', city: 'Mumbai' },
    });
    const html = await service.renderCertificateHtml('l-1');
    expect(html).toContain('TCS/2026-04/ABC');
    expect(html).toContain('Acme Pvt Ltd');
    expect(html).toContain('29ABCDE1234F1Z5');
    // Not a draft → no preview banner.
    expect(html).not.toContain('PREVIEW');
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

  it('is idempotent on REVERSED (wasAlreadyReversed=true)', async () => {
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
    expect(r.wasAlreadyReversed).toBe(true);
    expect(r.previousStatus).toBe('REVERSED');
    expect(r.ledger.status).toBe('REVERSED');
  });

  it('flips to REVERSED, stores reason on dedicated columns (not computedReason)', async () => {
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
        computedReason: 'auto-compute 2026-04',
        ...args.data,
      }),
    );
    const r = await service.reverse({
      ledgerId: 'l-x',
      reversedBy: 'admin-2',
      reason: 'finance correction',
    });
    expect(r.wasAlreadyReversed).toBe(false);
    expect(r.previousStatus).toBe('FILED');
    expect(r.reason).toBe('finance correction');
    expect(r.ledger.status).toBe('REVERSED');
    // Phase 160 (audit #8) — reason on a dedicated column; computedReason
    // is NOT overloaded / truncated.
    const updateArgs = prisma.gstTcsSettlementLedger.update.mock.calls[0][0];
    expect(updateArgs.data.reversalReason).toBe('finance correction');
    expect(updateArgs.data.reversedBy).toBe('admin-2');
    expect(updateArgs.data.computedReason).toBeUndefined();
    expect(r.ledger.computedReason).toBe('auto-compute 2026-04');
    // Phase 160 (audit #6) — a REVERSED lifecycle event carries the
    // full (untruncated) reason.
    expect(prisma.gstTcsLedgerEvent.create).toHaveBeenCalledTimes(1);
    const evt = prisma.gstTcsLedgerEvent.create.mock.calls[0][0].data;
    expect(evt.eventType).toBe('REVERSED');
    expect(evt.reason).toBe('finance correction');
  });
});

// Phase 160 (§52 lifecycle audit test #14) — DEBIT_NOTE additive to gross.
describe('TcsService.computeForSeller — DEBIT_NOTE handling', () => {
  it('adds DEBIT_NOTE taxable to gross (upward Section 34 correction)', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.taxDocument.findMany.mockResolvedValue([
      {
        documentType: 'TAX_INVOICE',
        taxableAmountInPaise: 1_000_000n,
        sellerStateCode: '29',
        placeOfSupplyStateCode: '29',
        supplierGstin: '29ABCDE1234F1Z5',
      },
      {
        documentType: 'DEBIT_NOTE',
        taxableAmountInPaise: 200_000n, // upward correction
        sellerStateCode: '29',
        placeOfSupplyStateCode: '29',
        supplierGstin: '29ABCDE1234F1Z5',
      },
    ]);
    prisma.gstTcsSettlementLedger.create.mockImplementation(async (args: any) => ({
      id: 'ledger-dn',
      ...args.data,
    }));
    await service.computeForSeller({ sellerId: 's-1', filingPeriod: '2026-04' });
    // assert DEBIT_NOTE was queried
    const where = prisma.taxDocument.findMany.mock.calls[0][0].where;
    expect(where.documentType.in).toContain('DEBIT_NOTE');
    const created = prisma.gstTcsSettlementLedger.create.mock.calls[0][0].data;
    // gross = 1_000_000 + 200_000 (debit note adds).
    expect(created.grossTaxableSupplyInPaise).toBe(1_200_000n);
    expect(created.netTaxableSupplyInPaise).toBe(1_200_000n);
  });
});

// Phase 160 (§52 lifecycle audit #9) — multi-GSTIN warning.
describe('TcsService.computeForSeller — multi-GSTIN warning', () => {
  it('flags MULTI_GSTIN when the period spans more than one supplier GSTIN', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.taxDocument.findMany.mockResolvedValue([
      {
        documentType: 'TAX_INVOICE',
        taxableAmountInPaise: 500_000n,
        sellerStateCode: '29',
        placeOfSupplyStateCode: '29',
        supplierGstin: '29ABCDE1234F1Z5',
      },
      {
        documentType: 'TAX_INVOICE',
        taxableAmountInPaise: 500_000n,
        sellerStateCode: '27',
        placeOfSupplyStateCode: '27',
        supplierGstin: '27ABCDE1234F1Z5', // different state GSTIN
      },
    ]);
    prisma.gstTcsSettlementLedger.create.mockImplementation(async (args: any) => ({
      id: 'ledger-mg',
      ...args.data,
    }));
    await service.computeForSeller({ sellerId: 's-1', filingPeriod: '2026-04' });
    const created = prisma.gstTcsSettlementLedger.create.mock.calls[0][0].data;
    const warnings = created.computeWarningsJson as { code: string }[];
    expect(warnings.some((w) => w.code === 'MULTI_GSTIN')).toBe(true);
    // first GSTIN still snapshotted (existing row shape unchanged).
    expect(created.supplierGstin).toBe('29ABCDE1234F1Z5');
  });

  it('no warning for a single-GSTIN period', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.taxDocument.findMany.mockResolvedValue([
      {
        documentType: 'TAX_INVOICE',
        taxableAmountInPaise: 500_000n,
        sellerStateCode: '29',
        placeOfSupplyStateCode: '29',
        supplierGstin: '29ABCDE1234F1Z5',
      },
    ]);
    prisma.gstTcsSettlementLedger.create.mockImplementation(async (args: any) => ({
      id: 'ledger-sg',
      ...args.data,
    }));
    await service.computeForSeller({ sellerId: 's-1', filingPeriod: '2026-04' });
    const created = prisma.gstTcsSettlementLedger.create.mock.calls[0][0].data;
    const warnings = created.computeWarningsJson as { code: string }[];
    expect(warnings.some((w) => w.code === 'MULTI_GSTIN')).toBe(false);
  });
});
