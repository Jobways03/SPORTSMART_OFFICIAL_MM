import 'reflect-metadata';
import { TaxDocumentPdfService } from '../../src/modules/tax/application/services/tax-document-pdf.service';

// Phase 19 GST — TaxDocumentPdfService tests.
//
// Unit-level: prisma + storage provider are mocked. The HTML template
// itself is exercised in tax-pdf-template.spec.ts.

function makeService(): {
  service: TaxDocumentPdfService;
  prisma: any;
  storage: any;
} {
  const prisma = {
    taxDocument: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const storage = {
    name: 'stub',
    upload: jest.fn(),
    createSignedUrl: jest.fn(),
  };
  // Phase 23 — TaxModeService stubbed to OFF so the existing tests
  // (DRAFT banner on by default) keep their assertions valid.
  const taxMode: any = {
    getMode: jest.fn().mockResolvedValue('OFF'),
  };
  const service = new TaxDocumentPdfService(
    prisma as any,
    storage as any,
    taxMode,
  );
  return { service, prisma, storage };
}

function makeRow(overrides: any = {}) {
  return {
    id: 'doc-1',
    documentNumber: 'SM-INV-000001',
    documentType: 'TAX_INVOICE',
    financialYear: '2026-27',
    invoiceType: 'B2C',
    generatedAt: new Date(Date.UTC(2026, 3, 15)),
    supplierGstin: '29ABCDE1234F1Z5',
    sellerLegalName: 'Acme',
    sellerAddressJson: null,
    sellerStateCode: '29',
    buyerGstin: null,
    buyerLegalName: 'Priya',
    billingAddressJson: null,
    shippingAddressJson: null,
    placeOfSupplyStateCode: '07',
    reverseChargeApplicable: false,
    reverseChargeReason: null,
    taxableAmountInPaise: 1_000_00n,
    cgstAmountInPaise: 0n,
    sgstAmountInPaise: 0n,
    igstAmountInPaise: 180_00n,
    totalTaxAmountInPaise: 180_00n,
    cessAmountInPaise: 0n,
    roundOffAmountInPaise: 0n,
    documentTotalInPaise: 1_180_00n,
    amountInWords: null,
    currencyCode: 'INR',
    paymentMode: null,
    originalDocumentNumber: null,
    reason: null,
    status: 'PDF_PENDING',
    pdfRetryCount: 0,
    lines: [
      {
        lineNumber: 1,
        productName: 'Bat',
        sku: null,
        hsnOrSacCode: '6404',
        uqcCode: 'PCS',
        quantity: 1 as any,
        unitPriceInPaise: 1_000_00n,
        discountAmountInPaise: 0n,
        taxableAmountInPaise: 1_000_00n,
        gstRateBps: 1800,
        cgstAmountInPaise: 0n,
        sgstAmountInPaise: 0n,
        igstAmountInPaise: 180_00n,
        cessAmountInPaise: 0n,
        lineTotalInPaise: 1_180_00n,
      },
    ],
    ...overrides,
  };
}

describe('TaxDocumentPdfService.renderAndUpload', () => {
  it('throws when the document does not exist', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(null);
    await expect(
      service.renderAndUpload({ documentId: 'nope' }),
    ).rejects.toThrow(/not found/);
  });

  it('refuses to render VOIDED_DRAFT documents', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeRow({ status: 'VOIDED_DRAFT' }),
    );
    await expect(
      service.renderAndUpload({ documentId: 'doc-1' }),
    ).rejects.toThrow(/not eligible/);
  });

  it('refuses to render SUPERSEDED documents', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeRow({ status: 'SUPERSEDED' }),
    );
    await expect(
      service.renderAndUpload({ documentId: 'doc-1' }),
    ).rejects.toThrow(/not eligible/);
  });

  it('renders + uploads + flips to PDF_GENERATED on success', async () => {
    const { service, prisma, storage } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(makeRow());
    storage.upload.mockResolvedValue({
      storagePath: '2026-27/29ABCDE1234F1Z5/TAX_INVOICE/SM-INV-000001.html',
      publicUrl: 'file:///abs/SM-INV-000001.html',
      sha256: 'deadbeef',
      provider: 'stub',
    });
    prisma.taxDocument.update.mockImplementation(async (args: any) => ({
      ...args.where,
      ...args.data,
    }));

    const result = await service.renderAndUpload({ documentId: 'doc-1' });
    expect(storage.upload).toHaveBeenCalledTimes(1);
    const uploadArgs = storage.upload.mock.calls[0][0];
    expect(uploadArgs.storagePath).toBe(
      '2026-27/29ABCDE1234F1Z5/TAX_INVOICE/SM-INV-000001.html',
    );
    expect(Buffer.isBuffer(uploadArgs.body)).toBe(true);
    expect(result.status).toBe('PDF_GENERATED');
    expect(result.pdfUrl).toBe('file:///abs/SM-INV-000001.html');
    expect(result.pdfFailureReason).toBeNull();
  });

  it('uses PLATFORM in storage path when supplierGstin is null (legacy)', async () => {
    const { service, prisma, storage } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeRow({
        documentType: 'LEGACY_RECEIPT',
        documentNumber: 'SM-LR-000003',
        supplierGstin: null,
      }),
    );
    storage.upload.mockResolvedValue({
      storagePath: '2026-27/PLATFORM/LEGACY_RECEIPT/SM-LR-000003.html',
      publicUrl: 'file:///abs/x',
      sha256: 'abc',
      provider: 'stub',
    });
    prisma.taxDocument.update.mockImplementation(async (args: any) => ({
      ...args.data,
    }));

    await service.renderAndUpload({ documentId: 'doc-1' });
    expect(storage.upload.mock.calls[0][0].storagePath).toBe(
      '2026-27/PLATFORM/LEGACY_RECEIPT/SM-LR-000003.html',
    );
  });

  it('sanitises slashes in documentNumber for storage path', async () => {
    const { service, prisma, storage } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeRow({ documentNumber: 'INV/2026-27/XYZ/00001' }),
    );
    storage.upload.mockResolvedValue({
      storagePath: 'x',
      publicUrl: 'x',
      sha256: 'x',
      provider: 'stub',
    });
    prisma.taxDocument.update.mockResolvedValue({});
    await service.renderAndUpload({ documentId: 'doc-1' });
    expect(storage.upload.mock.calls[0][0].storagePath).toContain(
      'INV-2026-27-XYZ-00001',
    );
  });

  it('propagates upload errors so the cron can catch + markFailed', async () => {
    const { service, prisma, storage } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(makeRow());
    storage.upload.mockRejectedValue(new Error('S3 503'));
    await expect(
      service.renderAndUpload({ documentId: 'doc-1' }),
    ).rejects.toThrow(/S3 503/);
    // Update should NOT have been called on failure path.
    expect(prisma.taxDocument.update).not.toHaveBeenCalled();
  });
});

describe('TaxDocumentPdfService.markAttemptFailed', () => {
  it('increments retryCount + stamps reason + flips to PDF_FAILED', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.update.mockResolvedValue({
      id: 'doc-1',
      documentNumber: 'SM-INV-000001',
      status: 'PDF_FAILED',
      pdfRetryCount: 1,
      pdfFailureReason: 'S3 timeout',
    });
    const r = await service.markAttemptFailed({
      documentId: 'doc-1',
      reason: 'S3 timeout',
    });
    const args = prisma.taxDocument.update.mock.calls[0][0];
    expect(args.data.status).toBe('PDF_FAILED');
    expect(args.data.pdfFailureReason).toBe('S3 timeout');
    expect(args.data.pdfRetryCount).toEqual({ increment: 1 });
    expect(r.status).toBe('PDF_FAILED');
  });
});

describe('TaxDocumentPdfService.getSignedDownloadUrl', () => {
  it('throws on unknown document', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(null);
    await expect(
      service.getSignedDownloadUrl({ documentId: 'nope' }),
    ).rejects.toThrow(/not found/);
  });

  it('refuses on PDF_PENDING (not yet rendered)', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue({
      id: 'doc-1',
      documentNumber: 'SM-INV-000001',
      status: 'PDF_PENDING',
      pdfStoragePath: null,
    });
    await expect(
      service.getSignedDownloadUrl({ documentId: 'doc-1' }),
    ).rejects.toThrow(/not yet PDF_GENERATED/);
  });

  it('refuses when pdfStoragePath is null', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue({
      id: 'doc-1',
      documentNumber: 'SM-INV-000001',
      status: 'PDF_GENERATED',
      pdfStoragePath: null,
    });
    await expect(
      service.getSignedDownloadUrl({ documentId: 'doc-1' }),
    ).rejects.toThrow(/not yet PDF_GENERATED/);
  });

  it('returns signed URL + increments download counter', async () => {
    const { service, prisma, storage } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue({
      id: 'doc-1',
      documentNumber: 'SM-INV-000001',
      status: 'PDF_GENERATED',
      pdfStoragePath: '2026-27/x/y/z.html',
    });
    storage.createSignedUrl.mockResolvedValue(
      'file:///abs/z.html?expires=123456',
    );
    prisma.taxDocument.update.mockResolvedValue({});

    const r = await service.getSignedDownloadUrl({
      documentId: 'doc-1',
      expiresInSeconds: 600,
    });
    expect(r.url).toBe('file:///abs/z.html?expires=123456');
    expect(r.documentNumber).toBe('SM-INV-000001');
    expect(storage.createSignedUrl).toHaveBeenCalledWith({
      storagePath: '2026-27/x/y/z.html',
      expiresInSeconds: 600,
    });
    expect(prisma.taxDocument.update).toHaveBeenCalled();
    const updArgs = prisma.taxDocument.update.mock.calls[0][0];
    expect(updArgs.data.downloadCount).toEqual({ increment: 1 });
  });

  it('does not throw when download-counter update races', async () => {
    const { service, prisma, storage } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue({
      id: 'doc-1',
      documentNumber: 'SM-INV-000001',
      status: 'PDF_GENERATED',
      pdfStoragePath: 'x',
    });
    storage.createSignedUrl.mockResolvedValue('file:///x');
    prisma.taxDocument.update.mockRejectedValue(new Error('race'));
    const r = await service.getSignedDownloadUrl({ documentId: 'doc-1' });
    expect(r.url).toBe('file:///x');
  });
});
