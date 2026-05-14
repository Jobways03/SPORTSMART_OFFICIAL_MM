import 'reflect-metadata';
import { TaxCompatibilityService } from '../../src/modules/tax/application/services/tax-compatibility.service';

// Phase 26 GST — TaxCompatibilityService tests.
//
// Three-way tagged-union resolution + display fallback shape.

function makeService(opts: { isLegacyOrder?: boolean } = {}): {
  service: TaxCompatibilityService;
  prisma: any;
  legacy: any;
} {
  const prisma: any = {
    orderItemTaxSnapshot: { findFirst: jest.fn() },
    orderItem: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    taxDocument: { findFirst: jest.fn() },
  };
  const legacy: any = {
    isLegacyOrder: jest.fn().mockResolvedValue(opts.isLegacyOrder ?? false),
  };
  return {
    service: new TaxCompatibilityService(prisma, legacy),
    prisma,
    legacy,
  };
}

describe('TaxCompatibilityService.resolveForOrderItem', () => {
  it('returns kind=snapshot when the snapshot exists', async () => {
    const { service, prisma } = makeService();
    prisma.orderItemTaxSnapshot.findFirst.mockResolvedValue({
      id: 'snap-1',
      orderItemId: 'oi-1',
      taxableAmountInPaise: 100_00n,
    });
    const r = await service.resolveForOrderItem('oi-1');
    expect(r.kind).toBe('snapshot');
    if (r.kind === 'snapshot') {
      expect(r.snapshot.id).toBe('snap-1');
    }
  });

  it('returns kind=pre_snapshot with zero when the order item is unknown', async () => {
    const { service, prisma } = makeService();
    prisma.orderItemTaxSnapshot.findFirst.mockResolvedValue(null);
    prisma.orderItem.findUnique.mockResolvedValue(null);
    const r = await service.resolveForOrderItem('oi-unknown');
    expect(r.kind).toBe('pre_snapshot');
    if (r.kind === 'pre_snapshot') {
      expect(r.orderItemTotalInPaise).toBe(0n);
    }
  });

  it('returns kind=legacy when isLegacyOrder + receipt exists', async () => {
    const { service, prisma, legacy } = makeService({ isLegacyOrder: true });
    prisma.orderItemTaxSnapshot.findFirst.mockResolvedValue(null);
    prisma.orderItem.findUnique.mockResolvedValue({
      totalPriceInPaise: 500_00n,
      subOrderId: 'sub-1',
    });
    prisma.taxDocument.findFirst.mockResolvedValue({
      id: 'doc-leg',
      documentNumber: 'SM-LR-000001',
    });
    const r = await service.resolveForOrderItem('oi-1');
    expect(r.kind).toBe('legacy');
    if (r.kind === 'legacy') {
      expect(r.legacyReceipt.documentNumber).toBe('SM-LR-000001');
    }
    expect(legacy.isLegacyOrder).toHaveBeenCalledWith('sub-1');
  });

  it('returns kind=pre_snapshot when isLegacyOrder but no receipt yet', async () => {
    const { service, prisma } = makeService({ isLegacyOrder: true });
    prisma.orderItemTaxSnapshot.findFirst.mockResolvedValue(null);
    prisma.orderItem.findUnique.mockResolvedValue({
      totalPriceInPaise: 250_00n,
      subOrderId: 'sub-1',
    });
    prisma.taxDocument.findFirst.mockResolvedValue(null);
    const r = await service.resolveForOrderItem('oi-1');
    expect(r.kind).toBe('pre_snapshot');
    if (r.kind === 'pre_snapshot') {
      expect(r.orderItemTotalInPaise).toBe(250_00n);
    }
  });

  it('returns kind=pre_snapshot when post-Phase-5 order has no snapshot', async () => {
    const { service, prisma } = makeService({ isLegacyOrder: false });
    prisma.orderItemTaxSnapshot.findFirst.mockResolvedValue(null);
    prisma.orderItem.findUnique.mockResolvedValue({
      totalPriceInPaise: 100_00n,
      subOrderId: 'sub-1',
    });
    const r = await service.resolveForOrderItem('oi-1');
    expect(r.kind).toBe('pre_snapshot');
    if (r.kind === 'pre_snapshot') {
      expect(r.orderItemTotalInPaise).toBe(100_00n);
    }
  });
});

describe('TaxCompatibilityService.resolveForSubOrder', () => {
  it('returns kind=invoice when a real TAX_INVOICE exists', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findFirst.mockResolvedValueOnce({
      id: 'doc-1',
      documentNumber: 'SM-INV-000001',
      documentType: 'TAX_INVOICE',
      status: 'PDF_GENERATED',
      documentTotalInPaise: 1_180_00n,
      taxableAmountInPaise: 1_000_00n,
      totalTaxAmountInPaise: 180_00n,
    });
    const r = await service.resolveForSubOrder('sub-1');
    expect(r.kind).toBe('invoice');
    expect(r.document?.documentNumber).toBe('SM-INV-000001');
  });

  it('returns kind=invoice for INVOICE_CUM_BILL_OF_SUPPLY', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findFirst.mockResolvedValueOnce({
      id: 'doc-2',
      documentNumber: 'SM-IBOS-000001',
      documentType: 'INVOICE_CUM_BILL_OF_SUPPLY',
      status: 'PDF_GENERATED',
      documentTotalInPaise: 500_00n,
      taxableAmountInPaise: 500_00n,
      totalTaxAmountInPaise: 0n,
    });
    const r = await service.resolveForSubOrder('sub-1');
    expect(r.kind).toBe('invoice');
  });

  it('falls back to LEGACY_RECEIPT lookup when no real invoice', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findFirst
      .mockResolvedValueOnce(null) // no real invoice
      .mockResolvedValueOnce({
        id: 'doc-leg',
        documentNumber: 'SM-LR-000005',
        documentType: 'LEGACY_RECEIPT',
        status: 'GENERATED',
        documentTotalInPaise: 250_00n,
        taxableAmountInPaise: 0n,
        totalTaxAmountInPaise: 0n,
      });
    const r = await service.resolveForSubOrder('sub-1');
    expect(r.kind).toBe('legacy');
    expect(r.document?.documentNumber).toBe('SM-LR-000005');
  });

  it('returns kind=absent when neither invoice nor receipt exists', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findFirst.mockResolvedValue(null);
    const r = await service.resolveForSubOrder('sub-1');
    expect(r.kind).toBe('absent');
    expect(r.document).toBeNull();
    expect(r.reason).toMatch(/No tax document/);
  });
});

describe('TaxCompatibilityService.getDisplayTaxBreakdown', () => {
  it('returns hasGstData=true with real totals when invoice exists', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findFirst.mockResolvedValueOnce({
      id: 'doc-1',
      documentNumber: 'SM-INV-1',
      documentType: 'TAX_INVOICE',
      status: 'PDF_GENERATED',
      documentTotalInPaise: 1_180_00n,
      taxableAmountInPaise: 1_000_00n,
      totalTaxAmountInPaise: 180_00n,
    });
    const r = await service.getDisplayTaxBreakdown('sub-1');
    expect(r.hasGstData).toBe(true);
    expect(r.grandTotalInPaise).toBe(1_180_00n);
    expect(r.taxableInPaise).toBe(1_000_00n);
    expect(r.totalTaxInPaise).toBe(180_00n);
    expect(r.disclosure).toBeUndefined();
  });

  it('returns hasGstData=false with disclosure when LEGACY_RECEIPT', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findFirst
      .mockResolvedValueOnce(null) // no real invoice
      .mockResolvedValueOnce({
        id: 'doc-leg',
        documentNumber: 'SM-LR-000005',
        documentType: 'LEGACY_RECEIPT',
        status: 'GENERATED',
        documentTotalInPaise: 250_00n,
        taxableAmountInPaise: 0n,
        totalTaxAmountInPaise: 0n,
      });
    prisma.orderItem.findMany.mockResolvedValue([
      { totalPriceInPaise: 200_00n },
      { totalPriceInPaise: 50_00n },
    ]);
    const r = await service.getDisplayTaxBreakdown('sub-1');
    expect(r.hasGstData).toBe(false);
    expect(r.grandTotalInPaise).toBe(250_00n);
    expect(r.disclosure).toMatch(/Pre-GST order/);
    expect(r.disclosure).toMatch(/SM-LR-000005/);
  });

  it('returns hasGstData=false with mid-checkout disclosure when no doc', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findFirst.mockResolvedValue(null);
    prisma.orderItem.findMany.mockResolvedValue([
      { totalPriceInPaise: 100_00n },
    ]);
    const r = await service.getDisplayTaxBreakdown('sub-1');
    expect(r.hasGstData).toBe(false);
    expect(r.grandTotalInPaise).toBe(100_00n);
    expect(r.disclosure).toMatch(/not yet generated/);
  });
});

describe('TaxCompatibilityService.safeGetSnapshot', () => {
  it('returns the snapshot row when present', async () => {
    const { service, prisma } = makeService();
    prisma.orderItemTaxSnapshot.findFirst.mockResolvedValue({
      id: 'snap-1',
      orderItemId: 'oi-1',
    });
    const r = await service.safeGetSnapshot('oi-1');
    expect(r?.id).toBe('snap-1');
  });

  it('returns null on DB error (no throw)', async () => {
    const { service, prisma } = makeService();
    prisma.orderItemTaxSnapshot.findFirst.mockRejectedValue(new Error('db'));
    const r = await service.safeGetSnapshot('oi-1');
    expect(r).toBeNull();
  });

  it('returns null when no snapshot exists', async () => {
    const { service, prisma } = makeService();
    prisma.orderItemTaxSnapshot.findFirst.mockResolvedValue(null);
    const r = await service.safeGetSnapshot('oi-1');
    expect(r).toBeNull();
  });
});
