/**
 * Phase 45 (2026-05-21) — verifies the invoice-generation gate runs
 * the TaxModeService.report() path for missing HSN, missing rate, and
 * unverified attestation. The full TaxDocumentService.generateForSubOrder
 * has lots of moving parts (sequence allocation, doc-type pick,
 * round-off, snapshots); this spec instead targets the private
 * `assertInvoiceLinesAreTaxReady` so the behaviour-under-each-mode
 * contract is isolated.
 *
 * The service is constructed with a stubbed Prisma + stubbed
 * TaxModeService whose .report() is the spy. We never throw from
 * .report() in this spec — the assertion is that report() is called
 * with the expected codes, which is what the OFF/AUDIT/STRICT modes
 * dispatch on.
 */

import { TaxDocumentService } from './tax-document.service';

function makeService(opts: {
  products: Array<{
    id: string;
    hsnCode: string | null;
    gstRateBps: number | null;
    supplyTaxability: string;
    taxConfigVerified: boolean;
  }>;
}) {
  const reportSpy = jest.fn().mockResolvedValue(null);
  const prisma: any = {
    product: {
      findMany: jest.fn(async () => opts.products),
    },
  };
  const taxMode: any = { report: reportSpy };
  const service = new TaxDocumentService(prisma, {} as any, {} as any, taxMode);
  return { service, reportSpy };
}

// We exercise the private method via a tiny wrapper to keep the
// spec narrowly scoped. TypeScript private is structural so a cast
// works here.
async function callGate(service: TaxDocumentService, snapshots: Array<{ productId: string }>): Promise<void> {
  await (service as any).assertInvoiceLinesAreTaxReady(snapshots);
}

describe('TaxDocumentService.assertInvoiceLinesAreTaxReady (Phase 45)', () => {
  it('emits no violations for a fully-attested TAXABLE product', async () => {
    const { service, reportSpy } = makeService({
      products: [
        { id: 'p1', hsnCode: '12345678', gstRateBps: 1800, supplyTaxability: 'TAXABLE', taxConfigVerified: true },
      ],
    });
    await callGate(service, [{ productId: 'p1' }]);
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it('reports product.missing_hsn for TAXABLE product with null HSN', async () => {
    const { service, reportSpy } = makeService({
      products: [
        { id: 'p1', hsnCode: null, gstRateBps: 1800, supplyTaxability: 'TAXABLE', taxConfigVerified: true },
      ],
    });
    await callGate(service, [{ productId: 'p1' }]);
    expect(reportSpy).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'product.missing_hsn', context: expect.objectContaining({ productId: 'p1' }) }),
    );
  });

  it('reports product.missing_hsn for malformed HSN', async () => {
    const { service, reportSpy } = makeService({
      products: [
        { id: 'p1', hsnCode: 'abc', gstRateBps: 1800, supplyTaxability: 'TAXABLE', taxConfigVerified: true },
      ],
    });
    await callGate(service, [{ productId: 'p1' }]);
    expect(reportSpy).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'product.missing_hsn' }),
    );
  });

  it('reports product.missing_rate for TAXABLE product with zero rate', async () => {
    const { service, reportSpy } = makeService({
      products: [
        { id: 'p1', hsnCode: '12345678', gstRateBps: 0, supplyTaxability: 'TAXABLE', taxConfigVerified: true },
      ],
    });
    await callGate(service, [{ productId: 'p1' }]);
    expect(reportSpy).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'product.missing_rate' }),
    );
  });

  it('reports product.unverified_config when taxConfigVerified=false', async () => {
    const { service, reportSpy } = makeService({
      products: [
        { id: 'p1', hsnCode: '12345678', gstRateBps: 1800, supplyTaxability: 'TAXABLE', taxConfigVerified: false },
      ],
    });
    await callGate(service, [{ productId: 'p1' }]);
    expect(reportSpy).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'product.unverified_config' }),
    );
  });

  it('skips HSN + rate checks for EXEMPT products (still requires attestation)', async () => {
    const { service, reportSpy } = makeService({
      products: [
        { id: 'p1', hsnCode: null, gstRateBps: 0, supplyTaxability: 'EXEMPT', taxConfigVerified: true },
      ],
    });
    await callGate(service, [{ productId: 'p1' }]);
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it('reports unverified for EXEMPT product without attestation', async () => {
    const { service, reportSpy } = makeService({
      products: [
        { id: 'p1', hsnCode: null, gstRateBps: 0, supplyTaxability: 'EXEMPT', taxConfigVerified: false },
      ],
    });
    await callGate(service, [{ productId: 'p1' }]);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'product.unverified_config' }),
    );
  });

  it('emits all three violations when a single product fails everything', async () => {
    const { service, reportSpy } = makeService({
      products: [
        { id: 'p1', hsnCode: null, gstRateBps: 0, supplyTaxability: 'TAXABLE', taxConfigVerified: false },
      ],
    });
    await callGate(service, [{ productId: 'p1' }]);
    expect(reportSpy).toHaveBeenCalledTimes(3);
    const codes = reportSpy.mock.calls.map((c) => c[0].code).sort();
    expect(codes).toEqual([
      'product.missing_hsn',
      'product.missing_rate',
      'product.unverified_config',
    ]);
  });

  it('de-dupes product fetch when snapshots reference the same productId', async () => {
    const { service } = makeService({
      products: [
        { id: 'p1', hsnCode: '12345678', gstRateBps: 1800, supplyTaxability: 'TAXABLE', taxConfigVerified: true },
      ],
    });
    await callGate(service, [{ productId: 'p1' }, { productId: 'p1' }, { productId: 'p1' }]);
    const prismaProductFindMany = (service as any).prisma.product.findMany;
    expect(prismaProductFindMany).toHaveBeenCalledTimes(1);
    expect(prismaProductFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['p1'] } },
      }),
    );
  });

  it('STRICT-mode behaviour bubbles up — report() that throws aborts the gate', async () => {
    const { service, reportSpy } = makeService({
      products: [
        { id: 'p1', hsnCode: null, gstRateBps: 1800, supplyTaxability: 'TAXABLE', taxConfigVerified: true },
      ],
    });
    // Simulate STRICT — TaxModeService.report() throws on the first
    // violation.
    reportSpy.mockImplementationOnce(async () => {
      throw new Error('TaxStrictMode: product.missing_hsn — ...');
    });
    await expect(callGate(service, [{ productId: 'p1' }])).rejects.toThrow(/TaxStrictMode/);
  });
});
