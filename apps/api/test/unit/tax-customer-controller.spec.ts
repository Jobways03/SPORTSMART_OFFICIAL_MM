import 'reflect-metadata';
import {
  CustomerTaxDocumentsController,
  mapDownloadError,
} from '../../src/modules/tax/presentation/controllers/customer-tax-documents.controller';
import { TaxDocumentDownloadDeniedError } from '../../src/modules/tax/application/services/tax-document-download.service';
import { PdfDocumentNotFoundError } from '../../src/modules/tax/application/services/tax-document-pdf.service';
import { HttpStatus } from '@nestjs/common';

// Phase 25 GST — Customer tax documents controller tests.

function makeController(): {
  controller: CustomerTaxDocumentsController;
  prisma: any;
  download: any;
} {
  const prisma = {
    taxDocument: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const download = { issueDownloadUrl: jest.fn() };
  const controller = new CustomerTaxDocumentsController(
    prisma as any,
    download as any,
  );
  return { controller, prisma, download };
}

describe('CustomerTaxDocumentsController.list', () => {
  it('scopes the query to req.userId + excludes VOIDED_DRAFT / SUPERSEDED', async () => {
    const { controller, prisma } = makeController();
    await controller.list({ userId: 'u-1' });
    const where = prisma.taxDocument.findMany.mock.calls[0][0].where;
    expect(where.customerId).toBe('u-1');
    expect(where.status.notIn).toEqual(['VOIDED_DRAFT', 'SUPERSEDED']);
  });

  it('serialises BigInt to string at the HTTP boundary', async () => {
    const { controller, prisma } = makeController();
    prisma.taxDocument.findMany.mockResolvedValue([
      {
        id: 'd-1',
        documentNumber: 'SM-INV-1',
        documentType: 'TAX_INVOICE',
        financialYear: '2026-27',
        generatedAt: new Date('2026-04-15'),
        status: 'PDF_GENERATED',
        einvoiceStatus: 'NOT_APPLICABLE',
        documentTotalInPaise: 1_180_00n,
      },
    ]);
    prisma.taxDocument.count.mockResolvedValue(1);

    const result = await controller.list({ userId: 'u-1' });
    expect(result.success).toBe(true);
    expect(result.data.items).toHaveLength(1);
    expect(result.data.items[0].documentTotalInPaise).toBe('118000');
    expect(result.data.pagination.totalPages).toBe(1);
  });

  it('clamps pagination at sane bounds', async () => {
    const { controller, prisma } = makeController();
    await controller.list({ userId: 'u-1' }, '0', '500');
    const args = prisma.taxDocument.findMany.mock.calls[0][0];
    expect(args.skip).toBe(0); // page → 1
    expect(args.take).toBe(50); // limit clamped to 50
  });
});

describe('CustomerTaxDocumentsController.download_', () => {
  it('passes CUSTOMER actor with ip + userAgent to the service', async () => {
    const { controller, download } = makeController();
    download.issueDownloadUrl.mockResolvedValue({
      url: 'https://x',
      documentNumber: 'SM-INV-1',
      documentId: 'd-1',
      expiresInSeconds: 300,
    });
    await controller.download_(
      {
        userId: 'u-1',
        ip: '203.0.113.1',
        headers: { 'user-agent': 'Mozilla' },
      },
      'd-1',
    );
    const args = download.issueDownloadUrl.mock.calls[0][0];
    expect(args.actor).toEqual({
      type: 'CUSTOMER',
      id: 'u-1',
      ip: '203.0.113.1',
      userAgent: 'Mozilla',
    });
  });

  it('honours a valid expiresInSeconds query param', async () => {
    const { controller, download } = makeController();
    download.issueDownloadUrl.mockResolvedValue({
      url: 'x',
      documentNumber: 'x',
      documentId: 'd-1',
      expiresInSeconds: 600,
    });
    await controller.download_({ userId: 'u-1' }, 'd-1', '600');
    expect(download.issueDownloadUrl.mock.calls[0][0].expiresInSeconds).toBe(
      600,
    );
  });

  it('rejects out-of-range expiresInSeconds (falls back to undefined)', async () => {
    const { controller, download } = makeController();
    download.issueDownloadUrl.mockResolvedValue({
      url: 'x',
      documentNumber: 'x',
      documentId: 'd-1',
      expiresInSeconds: 300,
    });
    await controller.download_({ userId: 'u-1' }, 'd-1', '99999');
    expect(
      download.issueDownloadUrl.mock.calls[0][0].expiresInSeconds,
    ).toBeUndefined();
  });

  it('maps DENIED_SCOPE → 403 Forbidden', async () => {
    const { controller, download } = makeController();
    download.issueDownloadUrl.mockRejectedValue(
      new TaxDocumentDownloadDeniedError(
        'DENIED_SCOPE',
        'wrong customer',
      ),
    );
    await expect(
      controller.download_({ userId: 'u-1' }, 'd-1'),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
  });

  it('maps DENIED_NOT_READY → 409 Conflict', async () => {
    const { controller, download } = makeController();
    download.issueDownloadUrl.mockRejectedValue(
      new TaxDocumentDownloadDeniedError('DENIED_NOT_READY', 'pdf pending'),
    );
    await expect(
      controller.download_({ userId: 'u-1' }, 'd-1'),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
  });

  it('maps DENIED_RATE_LIMIT → 429 Too Many Requests', async () => {
    const { controller, download } = makeController();
    download.issueDownloadUrl.mockRejectedValue(
      new TaxDocumentDownloadDeniedError('DENIED_RATE_LIMIT', 'too many'),
    );
    await expect(
      controller.download_({ userId: 'u-1' }, 'd-1'),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('maps PdfDocumentNotFoundError → 404', async () => {
    const { controller, download } = makeController();
    download.issueDownloadUrl.mockRejectedValue(
      new PdfDocumentNotFoundError('d-nope'),
    );
    await expect(
      controller.download_({ userId: 'u-1' }, 'd-nope'),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
  });
});

describe('mapDownloadError — outcome → status code matrix', () => {
  it('handles unknown error types as 500', () => {
    const err = mapDownloadError(new Error('mystery'));
    expect((err as any).status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('hides scope-vs-voided distinction (both → 403)', () => {
    const scope = mapDownloadError(
      new TaxDocumentDownloadDeniedError('DENIED_SCOPE', 'r'),
    );
    const voided = mapDownloadError(
      new TaxDocumentDownloadDeniedError('DENIED_VOIDED', 'r'),
    );
    expect((scope as any).status).toBe(HttpStatus.FORBIDDEN);
    expect((voided as any).status).toBe(HttpStatus.FORBIDDEN);
  });
});
