// Cluster E — TaxDocumentPdfService CAS regression tests.
//
// The critical fix: renderAndUpload + markAttemptFailed must flip
// status with a conditional (CAS) write scoped to the PDF
// sub-lifecycle (PDF_PENDING / PDF_FAILED). A concurrent credit-note
// flow can advance the row to PARTIALLY_REVERSED / FULLY_REVERSED
// between the service's read and its write; the plain `update` it used
// before would clobber that legal-reversal state with PDF_GENERATED /
// PDF_FAILED — a transition the FSM forbids. These tests pin the CAS
// so the regression can't silently come back.

// The HTML template runs for real otherwise (needs ~40 document
// fields); we mock it since this suite tests persistence, not layout.
jest.mock('../../domain/tax-document-html-template', () => ({
  renderHtmlForDocument: jest.fn(() => '<html>stub</html>'),
}));

import {
  TaxDocumentPdfService,
  PdfDocumentNotFoundError,
} from './tax-document-pdf.service';

function makeMocks() {
  const taxDocument = {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const prisma: any = { taxDocument };
  const storage: any = {
    upload: jest.fn().mockResolvedValue({
      storagePath: 'fy/PLATFORM/INVOICE/INV-1.html',
      publicUrl: 'file:///tmp/INV-1.html',
      sha256: 'a'.repeat(64),
      provider: 'stub',
    }),
    createSignedUrl: jest.fn(),
  };
  const taxMode: any = { getMode: jest.fn().mockResolvedValue('OFF') };
  // Combined-invoice PDF renderer (headless Chromium) — not exercised by these
  // unit tests, so a no-op stub satisfies the constructor.
  const htmlToPdf: any = { render: jest.fn().mockResolvedValue(Buffer.from('')) };
  const svc = new TaxDocumentPdfService(prisma, storage, taxMode, htmlToPdf);
  return { svc, prisma, taxDocument, storage, taxMode, htmlToPdf };
}

const aDoc = (over: Record<string, unknown> = {}) => ({
  id: 'doc-1',
  documentNumber: 'INV-1',
  documentType: 'INVOICE',
  financialYear: '2025-26',
  supplierGstin: null,
  status: 'PDF_PENDING',
  lines: [],
  ...over,
});

describe('TaxDocumentPdfService.renderAndUpload (CAS)', () => {
  it('flips PDF_PENDING → PDF_GENERATED via a status-scoped updateMany', async () => {
    const { svc, taxDocument } = makeMocks();
    taxDocument.findUnique.mockResolvedValueOnce(aDoc({ status: 'PDF_PENDING' }));
    taxDocument.updateMany.mockResolvedValueOnce({ count: 1 });
    taxDocument.findUniqueOrThrow.mockResolvedValueOnce(
      aDoc({ status: 'PDF_GENERATED' }),
    );

    const out = await svc.renderAndUpload({ documentId: 'doc-1' });

    expect(taxDocument.update).not.toHaveBeenCalled();
    expect(taxDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'doc-1',
          status: { in: ['PDF_PENDING', 'PDF_FAILED'] },
        },
        data: expect.objectContaining({ status: 'PDF_GENERATED' }),
      }),
    );
    expect(out.status).toBe('PDF_GENERATED');
  });

  it('does NOT clobber a row that raced to PARTIALLY_REVERSED (CAS count=0)', async () => {
    const { svc, taxDocument } = makeMocks();
    // Read sees PDF_PENDING…
    taxDocument.findUnique
      .mockResolvedValueOnce(aDoc({ status: 'PDF_PENDING' }))
      // …but by the time the CAS misses, the row is PARTIALLY_REVERSED.
      .mockResolvedValueOnce(aDoc({ status: 'PARTIALLY_REVERSED' }));
    taxDocument.updateMany.mockResolvedValueOnce({ count: 0 });

    const out = await svc.renderAndUpload({ documentId: 'doc-1' });

    // Returns the current (reversed) row, never overwrites it.
    expect(out.status).toBe('PARTIALLY_REVERSED');
    expect(taxDocument.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('throws NotFound if the row vanished after a missed CAS', async () => {
    const { svc, taxDocument } = makeMocks();
    taxDocument.findUnique
      .mockResolvedValueOnce(aDoc({ status: 'PDF_PENDING' }))
      .mockResolvedValueOnce(null);
    taxDocument.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(svc.renderAndUpload({ documentId: 'doc-1' })).rejects.toBeInstanceOf(
      PdfDocumentNotFoundError,
    );
  });
});

describe('TaxDocumentPdfService.markAttemptFailed (CAS)', () => {
  it('stamps PDF_FAILED only while still in the PDF sub-lifecycle', async () => {
    const { svc, taxDocument } = makeMocks();
    taxDocument.updateMany.mockResolvedValueOnce({ count: 1 });
    taxDocument.findUniqueOrThrow.mockResolvedValueOnce(
      aDoc({ status: 'PDF_FAILED', pdfRetryCount: 1 }),
    );

    await svc.markAttemptFailed({ documentId: 'doc-1', reason: 'boom' });

    expect(taxDocument.update).not.toHaveBeenCalled();
    expect(taxDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'doc-1',
          status: { in: ['PDF_PENDING', 'PDF_FAILED'] },
        },
        data: expect.objectContaining({
          status: 'PDF_FAILED',
          pdfRetryCount: { increment: 1 },
        }),
      }),
    );
  });

  it('does not yank a reversed row back to PDF_FAILED (CAS count=0)', async () => {
    const { svc, taxDocument } = makeMocks();
    taxDocument.updateMany.mockResolvedValueOnce({ count: 0 });
    taxDocument.findUniqueOrThrow.mockResolvedValueOnce(
      aDoc({ status: 'FULLY_REVERSED', pdfRetryCount: 0 }),
    );

    const out = await svc.markAttemptFailed({ documentId: 'doc-1', reason: 'boom' });

    expect(out.status).toBe('FULLY_REVERSED');
    expect(taxDocument.update).not.toHaveBeenCalled();
  });
});
