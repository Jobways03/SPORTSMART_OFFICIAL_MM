import 'reflect-metadata';
import { TaxAuditReadinessService } from '../../src/modules/tax/application/services/tax-audit-readiness.service';

// Phase 23 GST — TaxAuditReadinessService tests.
//
// Verifies the report shape + ready=true on zeroed-out scans +
// ready=false on any blocker count > 0 + currentMode threading.

function makeService(opts: {
  currentMode?: 'OFF' | 'AUDIT' | 'STRICT';
  productMissingHsn?: number;
  productMissingRate?: number;
  sellerMissingGstin?: number;
  einvoiceUnresolved?: number;
  pdfUnresolved?: number;
  tcsRows?: Array<{ id: string; filingPeriod: string }>;
  timebarRequiresReview?: number;
} = {}): {
  service: TaxAuditReadinessService;
} {
  const sample = (n: number) =>
    Array.from({ length: Math.min(n, 5) }, (_, i) => ({ id: `id-${i}` }));

  const prisma: any = {
    product: {
      count: jest.fn(async (args: any) => {
        if ('hsnCode' in (args?.where?.OR?.[0] ?? {})) {
          return opts.productMissingHsn ?? 0;
        }
        return opts.productMissingRate ?? 0;
      }),
      findMany: jest.fn(async (args: any) => {
        if ('hsnCode' in (args?.where?.OR?.[0] ?? {})) {
          return sample(opts.productMissingHsn ?? 0);
        }
        return sample(opts.productMissingRate ?? 0);
      }),
    },
    seller: {
      count: jest.fn().mockResolvedValue(opts.sellerMissingGstin ?? 0),
      findMany: jest
        .fn()
        .mockResolvedValue(sample(opts.sellerMissingGstin ?? 0)),
    },
    taxDocument: {
      count: jest.fn(async (args: any) => {
        if ('einvoiceStatus' in (args?.where ?? {})) {
          return opts.einvoiceUnresolved ?? 0;
        }
        return opts.pdfUnresolved ?? 0;
      }),
      findMany: jest.fn(async (args: any) => {
        if ('einvoiceStatus' in (args?.where ?? {})) {
          return sample(opts.einvoiceUnresolved ?? 0);
        }
        return sample(opts.pdfUnresolved ?? 0);
      }),
    },
    gstTcsSettlementLedger: {
      findMany: jest.fn().mockResolvedValue(opts.tcsRows ?? []),
    },
    return: {
      count: jest.fn().mockResolvedValue(opts.timebarRequiresReview ?? 0),
      findMany: jest
        .fn()
        .mockResolvedValue(sample(opts.timebarRequiresReview ?? 0)),
    },
  };
  const env: any = {
    getNumber: (_k: string, fb: number) => fb,
  };
  const mode: any = {
    getMode: jest.fn().mockResolvedValue(opts.currentMode ?? 'OFF'),
  };
  return {
    service: new TaxAuditReadinessService(prisma, env, mode),
  };
}

describe('TaxAuditReadinessService.build', () => {
  it('returns ready=true when every counter is zero', async () => {
    const { service } = makeService();
    const r = await service.build();
    expect(r.ready).toBe(true);
    expect(r.totalBlockers).toBe(0);
    expect(r.blockers).toHaveLength(7); // all seven blocker classes present
    for (const b of r.blockers) {
      expect(b.count).toBe(0);
      expect(b.sampleIds).toEqual([]);
    }
  });

  it('threads currentMode into the report', async () => {
    const { service } = makeService({ currentMode: 'AUDIT' });
    const r = await service.build();
    expect(r.currentMode).toBe('AUDIT');
  });

  it('returns ready=false when product.missing_hsn > 0', async () => {
    const { service } = makeService({ productMissingHsn: 3 });
    const r = await service.build();
    expect(r.ready).toBe(false);
    expect(r.totalBlockers).toBe(3);
    const hsn = r.blockers.find((b) => b.code === 'product.missing_hsn');
    expect(hsn?.count).toBe(3);
    expect(hsn?.sampleIds).toHaveLength(3);
  });

  it('caps sample IDs at 5 even for very large counts', async () => {
    const { service } = makeService({ productMissingRate: 1_000 });
    const r = await service.build();
    const rate = r.blockers.find((b) => b.code === 'product.missing_rate');
    expect(rate?.count).toBe(1_000);
    expect(rate?.sampleIds).toHaveLength(5);
  });

  it('sums every blocker class into totalBlockers', async () => {
    const { service } = makeService({
      productMissingHsn: 1,
      productMissingRate: 2,
      sellerMissingGstin: 3,
      einvoiceUnresolved: 4,
      pdfUnresolved: 5,
      timebarRequiresReview: 6,
    });
    const r = await service.build();
    expect(r.totalBlockers).toBe(1 + 2 + 3 + 4 + 5 + 6);
    expect(r.ready).toBe(false);
  });

  it('flags TCS rows past their 10th-of-next-month deadline', async () => {
    // Row from Jan 2020 — deadline 10 Feb 2020 — far in the past now.
    const { service } = makeService({
      tcsRows: [{ id: 'tcs-overdue', filingPeriod: '2020-01' }],
    });
    const r = await service.build();
    const tcs = r.blockers.find((b) => b.code === 'tcs.unfiled');
    expect(tcs?.count).toBe(1);
    expect(tcs?.sampleIds).toEqual(['tcs-overdue']);
  });

  it('does not flag TCS rows still within the filing window', async () => {
    // A row from a far-future filing period — deadline is still ahead.
    const { service } = makeService({
      tcsRows: [{ id: 'tcs-future', filingPeriod: '2099-12' }],
    });
    const r = await service.build();
    const tcs = r.blockers.find((b) => b.code === 'tcs.unfiled');
    expect(tcs?.count).toBe(0);
  });

  it('emits a generatedAt timestamp on every report', async () => {
    const { service } = makeService();
    const before = Date.now();
    const r = await service.build();
    expect(r.generatedAt).toBeInstanceOf(Date);
    expect(r.generatedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});
