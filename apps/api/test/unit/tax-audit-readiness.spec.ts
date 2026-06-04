import 'reflect-metadata';
import {
  TaxAuditReadinessService,
  latestOverdueTcsPeriod,
} from '../../src/modules/tax/application/services/tax-audit-readiness.service';

// Phase 23 + Phase 163 — TaxAuditReadinessService tests.
//
// Verifies the report shape (severity #11 + resourceType #12), ready=true
// on zeroed-out scans, ready=false per-scanner, currentMode threading,
// the new blocker classes (#2/#13), the criticalBlockers rollup, scope
// filtering (#6), the TCS WHERE-clause cutoff (#1), and — critically —
// that a DB error PROPAGATES instead of being swallowed into ready=true (#4).

const ALL_CODES = [
  'product.missing_hsn',
  'product.missing_rate',
  'product.missing_uqc',
  'product.unverified_config',
  'seller.missing_gstin',
  'seller.gstin_legal_name_mismatch',
  'platform.gst_profile_missing',
  'invoice.draft_stuck',
  'einvoice.unresolved',
  'pdf.unresolved',
  'ewaybill.unresolved',
  'tcs.unfiled',
  'tds.withheld_undeposited',
  'timebar.requires_review',
];

interface Opts {
  currentMode?: 'OFF' | 'AUDIT' | 'STRICT';
  productMissingHsn?: number;
  productMissingRate?: number;
  productMissingUqc?: number;
  productUnverified?: number;
  sellerMissingGstin?: number;
  sellerLegalNameMismatch?: number;
  platformGstMissing?: boolean;
  draftStuck?: number;
  einvoiceUnresolved?: number;
  pdfUnresolved?: number;
  ewaybillUnresolved?: number;
  tcsUnfiled?: number;
  tdsWithheld?: number;
  timebarRequiresReview?: number;
}

function sample(n: number) {
  return Array.from({ length: Math.min(n, 5) }, (_, i) => ({ id: `id-${i}` }));
}

function delegate(countFor: (where: any) => number) {
  return {
    count: jest.fn(async ({ where }: any) => countFor(where)),
    findMany: jest.fn(async ({ where }: any) => sample(countFor(where))),
  };
}

function makeService(opts: Opts = {}): {
  service: TaxAuditReadinessService;
  prisma: any;
} {
  const prisma: any = {
    product: delegate((where) => {
      if (where.taxConfigVerified === false) return opts.productUnverified ?? 0;
      const orKey = where.OR?.[0] ? Object.keys(where.OR[0])[0] : null;
      if (orKey === 'hsnCode') return opts.productMissingHsn ?? 0;
      if (orKey === 'gstRateBps') return opts.productMissingRate ?? 0;
      if (orKey === 'defaultUqcCode') return opts.productMissingUqc ?? 0;
      return 0;
    }),
    seller: delegate((where) => {
      if (where.gstins?.none) return opts.sellerMissingGstin ?? 0;
      if (where.gstins?.some) return opts.sellerLegalNameMismatch ?? 0;
      return 0;
    }),
    platformGstProfile: {
      findFirst: jest.fn(async () => (opts.platformGstMissing ? null : { id: 'pgp-1' })),
    },
    taxDocument: delegate((where) => {
      if (where.status === 'DRAFT') return opts.draftStuck ?? 0;
      if (where.einvoiceStatus) return opts.einvoiceUnresolved ?? 0;
      if (where.pdfRetryCount !== undefined) return opts.pdfUnresolved ?? 0;
      return 0;
    }),
    eWayBill: delegate(() => opts.ewaybillUnresolved ?? 0),
    gstTcsSettlementLedger: delegate(() => opts.tcsUnfiled ?? 0),
    section194OTdsLedger: delegate(() => opts.tdsWithheld ?? 0),
    return: delegate(() => opts.timebarRequiresReview ?? 0),
    taxReadinessSnapshot: {
      create: jest.fn(async () => ({})),
      findMany: jest.fn(async () => []),
    },
  };
  const env: any = { getNumber: (_k: string, fb: number) => fb };
  const mode: any = { getMode: jest.fn().mockResolvedValue(opts.currentMode ?? 'OFF') };
  return { service: new TaxAuditReadinessService(prisma, env, mode), prisma };
}

describe('TaxAuditReadinessService.build', () => {
  it('returns ready=true when every counter is zero (14 blocker classes)', async () => {
    const { service } = makeService();
    const r = await service.build();
    expect(r.ready).toBe(true);
    expect(r.totalBlockers).toBe(0);
    expect(r.criticalBlockers).toBe(0);
    expect(r.blockers).toHaveLength(14);
    expect(r.blockers.map((b) => b.code).sort()).toEqual([...ALL_CODES].sort());
    for (const b of r.blockers) {
      expect(b.count).toBe(0);
      expect(b.sampleIds).toEqual([]);
      // #11 / #12 — every blocker carries a severity + resourceType.
      expect(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).toContain(b.severity);
      expect(typeof b.resourceType).toBe('string');
    }
  });

  it('threads currentMode + echoes the (empty) filter', async () => {
    const { service } = makeService({ currentMode: 'AUDIT' });
    const r = await service.build();
    expect(r.currentMode).toBe('AUDIT');
    expect(r.filter).toEqual({ sellerId: null, filingPeriod: null, gstProfileId: null });
  });

  it('ready=false when any single scanner is non-zero', async () => {
    const { service } = makeService({ productMissingHsn: 3 });
    const r = await service.build();
    expect(r.ready).toBe(false);
    expect(r.totalBlockers).toBe(3);
    const hsn = r.blockers.find((b) => b.code === 'product.missing_hsn');
    expect(hsn?.count).toBe(3);
    expect(hsn?.sampleIds).toHaveLength(3);
    expect(hsn?.severity).toBe('HIGH');
    expect(hsn?.resourceType).toBe('product');
  });

  it('flags the NEW blocker classes (#2 / #13)', async () => {
    const { service } = makeService({
      productMissingUqc: 2,
      sellerLegalNameMismatch: 1,
      platformGstMissing: true,
      draftStuck: 4,
      ewaybillUnresolved: 5,
      tdsWithheld: 6,
    });
    const r = await service.build();
    const c = (code: string) => r.blockers.find((b) => b.code === code)?.count;
    expect(c('product.missing_uqc')).toBe(2);
    expect(c('seller.gstin_legal_name_mismatch')).toBe(1);
    expect(c('platform.gst_profile_missing')).toBe(1);
    expect(c('invoice.draft_stuck')).toBe(4);
    expect(c('ewaybill.unresolved')).toBe(5);
    expect(c('tds.withheld_undeposited')).toBe(6);
    expect(r.ready).toBe(false);
  });

  it('rolls CRITICAL-severity counts into criticalBlockers (#11)', async () => {
    // CRITICAL classes: seller.missing_gstin, platform.gst_profile_missing,
    // tcs.unfiled, tds.withheld_undeposited.
    const { service } = makeService({
      sellerMissingGstin: 2,
      platformGstMissing: true,
      tcsUnfiled: 3,
      tdsWithheld: 4,
      productMissingHsn: 9, // HIGH — must NOT count toward criticalBlockers
    });
    const r = await service.build();
    expect(r.criticalBlockers).toBe(2 + 1 + 3 + 4);
    expect(r.totalBlockers).toBe(2 + 1 + 3 + 4 + 9);
  });

  it('caps sample IDs at 5 even for very large counts', async () => {
    const { service } = makeService({ productMissingRate: 1_000 });
    const r = await service.build();
    const rate = r.blockers.find((b) => b.code === 'product.missing_rate');
    expect(rate?.count).toBe(1_000);
    expect(rate?.sampleIds).toHaveLength(5);
  });

  // #4 — the single most important behaviour change. A DB error must NOT
  // be swallowed into a false ready=true.
  it('PROPAGATES a DB error instead of returning ready=true (#4)', async () => {
    const { service, prisma } = makeService();
    prisma.gstTcsSettlementLedger.count.mockRejectedValueOnce(new Error('db down'));
    await expect(service.build()).rejects.toThrow('db down');
  });

  it('applies the active-product filter (#15) + seller scope (#6)', async () => {
    const { service, prisma } = makeService({ sellerMissingGstin: 1 });
    await service.build({ sellerId: 'seller-9' });
    // Product scans are scoped to ACTIVE + non-deleted + the seller.
    const productWhere = prisma.product.count.mock.calls[0]![0].where;
    expect(productWhere.status).toBe('ACTIVE');
    expect(productWhere.isDeleted).toBe(false);
    expect(productWhere.sellerId).toBe('seller-9');
    // Seller scan scoped by id.
    const sellerWhere = prisma.seller.count.mock.calls[0]![0].where;
    expect(sellerWhere.id).toBe('seller-9');
  });

  it('TCS scan filters by a filingPeriod <= cutoff WHERE clause, not in-memory (#1)', async () => {
    const { service, prisma } = makeService({ tcsUnfiled: 7 });
    const r = await service.build();
    expect(r.blockers.find((b) => b.code === 'tcs.unfiled')?.count).toBe(7);
    const tcsWhere = prisma.gstTcsSettlementLedger.count.mock.calls[0]![0].where;
    expect(tcsWhere.status).toEqual({ in: ['COMPUTED', 'COLLECTED'] });
    expect(tcsWhere.filingPeriod).toHaveProperty('lte');
    expect(typeof tcsWhere.filingPeriod.lte).toBe('string');
    // No take:1000 anywhere — the count query carries no take.
    expect(prisma.gstTcsSettlementLedger.count.mock.calls[0]![0].take).toBeUndefined();
  });
});

describe('persistSnapshot / history (#16)', () => {
  it('persists a snapshot row', async () => {
    const { service, prisma } = makeService({ tcsUnfiled: 2 });
    const report = await service.build();
    await service.persistSnapshot(report);
    expect(prisma.taxReadinessSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalBlockers: 2,
          currentMode: 'OFF',
          ready: false,
        }),
      }),
    );
  });

  it('clamps the history window to [1, 365] days', async () => {
    const { service, prisma } = makeService();
    await service.history(99999);
    const since = prisma.taxReadinessSnapshot.findMany.mock.calls[0]![0].where.generatedAt.gte;
    const daysAgo = (Date.now() - since.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeLessThanOrEqual(366);
    expect(daysAgo).toBeGreaterThanOrEqual(364);
  });
});

describe('latestOverdueTcsPeriod (#1)', () => {
  it('after the 10th: the just-closed month is overdue', () => {
    // 2026-05-29 IST — past the 10th → April (2026-04) is the latest overdue.
    expect(latestOverdueTcsPeriod(new Date('2026-05-29T00:00:00Z'))).toBe('2026-04');
  });

  it('on/before the 10th: step back one more month', () => {
    // 2026-05-08 IST — not past the 10th → March (2026-03) is the latest overdue.
    expect(latestOverdueTcsPeriod(new Date('2026-05-08T00:00:00Z'))).toBe('2026-03');
  });

  it('rolls the year boundary', () => {
    // 2026-01-29 → past the 10th → Dec 2025 overdue.
    expect(latestOverdueTcsPeriod(new Date('2026-01-29T00:00:00Z'))).toBe('2025-12');
    // 2026-01-05 → before the 10th → Nov 2025.
    expect(latestOverdueTcsPeriod(new Date('2026-01-05T00:00:00Z'))).toBe('2025-11');
  });
});
