import 'reflect-metadata';
import {
  TaxDocumentDownloadService,
  TaxDocumentDownloadDeniedError,
} from '../../src/modules/tax/application/services/tax-document-download.service';

// Phase 20 GST — TaxDocumentDownloadService tests.
//
// Unit-level: prisma + PdfService are mocked. The PDF render path
// itself is covered in tax-pdf-service.spec.ts.

function makeService(envOverrides: any = {}): {
  service: TaxDocumentDownloadService;
  prisma: any;
  pdfService: any;
} {
  const prisma = {
    taxDocument: { findUnique: jest.fn() },
    taxDocumentDownloadAudit: {
      create: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const pdfService = {
    getSignedDownloadUrl: jest.fn(),
  };
  const env: any = {
    getNumber: (key: string, fb: number) =>
      envOverrides[key] !== undefined ? envOverrides[key] : fb,
  };
  const service = new TaxDocumentDownloadService(
    prisma as any,
    env,
    pdfService as any,
  );
  return { service, prisma, pdfService };
}

function makeDoc(o: any = {}) {
  return {
    id: 'doc-1',
    documentNumber: 'SM-INV-000001',
    status: 'PDF_GENERATED',
    customerId: 'u-1',
    sellerId: 'sel-1',
    ...o,
  };
}

describe('TaxDocumentDownloadService.issueDownloadUrl — not-found', () => {
  it('throws PdfDocumentNotFoundError for missing document', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(null);
    await expect(
      service.issueDownloadUrl({
        documentId: 'nope',
        actor: { type: 'CUSTOMER', id: 'u-1' },
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe('TaxDocumentDownloadService — VOIDED / SUPERSEDED', () => {
  it('denies VOIDED_DRAFT with DENIED_VOIDED audit', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ status: 'VOIDED_DRAFT' }),
    );
    await expect(
      service.issueDownloadUrl({
        documentId: 'doc-1',
        actor: { type: 'ADMIN', id: 'adm-1' },
      }),
    ).rejects.toThrow(TaxDocumentDownloadDeniedError);
    const auditArgs =
      prisma.taxDocumentDownloadAudit.create.mock.calls[0][0].data;
    expect(auditArgs.outcome).toBe('DENIED_VOIDED');
    expect(auditArgs.actorType).toBe('ADMIN');
  });

  it('denies SUPERSEDED with DENIED_VOIDED audit', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ status: 'SUPERSEDED' }),
    );
    await expect(
      service.issueDownloadUrl({
        documentId: 'doc-1',
        actor: { type: 'CUSTOMER', id: 'u-1' },
      }),
    ).rejects.toThrow(/DENIED_VOIDED/);
  });
});

describe('TaxDocumentDownloadService — scope checks', () => {
  it('CUSTOMER denied when customerId mismatches', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ customerId: 'u-other' }),
    );
    await expect(
      service.issueDownloadUrl({
        documentId: 'doc-1',
        actor: { type: 'CUSTOMER', id: 'u-1' },
      }),
    ).rejects.toThrow(/DENIED/);
    const auditArgs =
      prisma.taxDocumentDownloadAudit.create.mock.calls[0][0].data;
    expect(auditArgs.outcome).toBe('DENIED_SCOPE');
    expect(auditArgs.denyReason).toMatch(/cannot access invoice/);
  });

  it('CUSTOMER allowed when customerId matches', async () => {
    const { service, prisma, pdfService } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(makeDoc({ customerId: 'u-1' }));
    pdfService.getSignedDownloadUrl.mockResolvedValue({
      url: 'file:///x',
      documentNumber: 'SM-INV-000001',
    });
    const r = await service.issueDownloadUrl({
      documentId: 'doc-1',
      actor: { type: 'CUSTOMER', id: 'u-1' },
    });
    expect(r.url).toBe('file:///x');
    const auditArgs =
      prisma.taxDocumentDownloadAudit.create.mock.calls[0][0].data;
    expect(auditArgs.outcome).toBe('ALLOWED');
  });

  it('SELLER denied when sellerId mismatches', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ sellerId: 'sel-other' }),
    );
    await expect(
      service.issueDownloadUrl({
        documentId: 'doc-1',
        actor: { type: 'SELLER', id: 'sel-1' },
      }),
    ).rejects.toThrow(/DENIED/);
  });

  it('SELLER allowed when sellerId matches', async () => {
    const { service, prisma, pdfService } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(makeDoc({ sellerId: 'sel-1' }));
    pdfService.getSignedDownloadUrl.mockResolvedValue({
      url: 'file:///x',
      documentNumber: 'SM-INV-000001',
    });
    const r = await service.issueDownloadUrl({
      documentId: 'doc-1',
      actor: { type: 'SELLER', id: 'sel-1' },
    });
    expect(r.url).toBe('file:///x');
  });

  it('FRANCHISE follows seller scope rules', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ sellerId: 'franchise-other' }),
    );
    await expect(
      service.issueDownloadUrl({
        documentId: 'doc-1',
        actor: { type: 'FRANCHISE', id: 'franchise-1' },
      }),
    ).rejects.toThrow(/FRANCHISE franchise-1/);
  });

  it('ADMIN bypasses scope but still audits', async () => {
    const { service, prisma, pdfService } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ customerId: 'u-anyone', sellerId: 'sel-anyone' }),
    );
    pdfService.getSignedDownloadUrl.mockResolvedValue({
      url: 'file:///x',
      documentNumber: 'SM-INV-000001',
    });
    const r = await service.issueDownloadUrl({
      documentId: 'doc-1',
      actor: { type: 'ADMIN', id: 'adm-7', role: 'finance_admin' },
    });
    expect(r.url).toBe('file:///x');
    const auditArgs =
      prisma.taxDocumentDownloadAudit.create.mock.calls[0][0].data;
    expect(auditArgs.actorRole).toBe('finance_admin');
  });

  it('SYSTEM bypasses scope and rate limit', async () => {
    const { service, prisma, pdfService } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(makeDoc());
    pdfService.getSignedDownloadUrl.mockResolvedValue({
      url: 'file:///x',
      documentNumber: 'SM-INV-000001',
    });
    const r = await service.issueDownloadUrl({
      documentId: 'doc-1',
      actor: { type: 'SYSTEM', id: 'cron-pdf-retry' },
    });
    expect(r.url).toBe('file:///x');
    // SYSTEM never queries the rate-limit count.
    expect(prisma.taxDocumentDownloadAudit.count).not.toHaveBeenCalled();
  });
});

describe('TaxDocumentDownloadService — PDF not ready', () => {
  it('denies PDF_PENDING with DENIED_NOT_READY', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ customerId: 'u-1', status: 'PDF_PENDING' }),
    );
    await expect(
      service.issueDownloadUrl({
        documentId: 'doc-1',
        actor: { type: 'CUSTOMER', id: 'u-1' },
      }),
    ).rejects.toThrow(/DENIED_NOT_READY/);
    const auditArgs =
      prisma.taxDocumentDownloadAudit.create.mock.calls[0][0].data;
    expect(auditArgs.outcome).toBe('DENIED_NOT_READY');
  });

  it('denies PDF_FAILED with DENIED_NOT_READY', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ customerId: 'u-1', status: 'PDF_FAILED' }),
    );
    await expect(
      service.issueDownloadUrl({
        documentId: 'doc-1',
        actor: { type: 'CUSTOMER', id: 'u-1' },
      }),
    ).rejects.toThrow(/DENIED_NOT_READY/);
  });
});

describe('TaxDocumentDownloadService — rate limiting', () => {
  it('denies when recent-download count >= cap', async () => {
    const { service, prisma } = makeService({
      TAX_DOWNLOAD_RATE_LIMIT_PER_WINDOW: 3,
    });
    prisma.taxDocument.findUnique.mockResolvedValue(makeDoc({ customerId: 'u-1' }));
    prisma.taxDocumentDownloadAudit.count.mockResolvedValue(3);
    await expect(
      service.issueDownloadUrl({
        documentId: 'doc-1',
        actor: { type: 'CUSTOMER', id: 'u-1' },
      }),
    ).rejects.toThrow(/DENIED_RATE_LIMIT/);
    const auditArgs =
      prisma.taxDocumentDownloadAudit.create.mock.calls[0][0].data;
    expect(auditArgs.outcome).toBe('DENIED_RATE_LIMIT');
  });

  it('allows when recent-download count < cap', async () => {
    const { service, prisma, pdfService } = makeService({
      TAX_DOWNLOAD_RATE_LIMIT_PER_WINDOW: 5,
    });
    prisma.taxDocument.findUnique.mockResolvedValue(makeDoc({ customerId: 'u-1' }));
    prisma.taxDocumentDownloadAudit.count.mockResolvedValue(2);
    pdfService.getSignedDownloadUrl.mockResolvedValue({
      url: 'file:///x',
      documentNumber: 'SM-INV-000001',
    });
    const r = await service.issueDownloadUrl({
      documentId: 'doc-1',
      actor: { type: 'CUSTOMER', id: 'u-1' },
    });
    expect(r.url).toBe('file:///x');
  });
});

describe('TaxDocumentDownloadService — audit failure resilience', () => {
  it('does not block the deny when audit write fails', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ status: 'VOIDED_DRAFT' }),
    );
    prisma.taxDocumentDownloadAudit.create.mockRejectedValue(
      new Error('db down'),
    );
    // The deny should still throw — we don't swallow it because the
    // audit-write failed.
    await expect(
      service.issueDownloadUrl({
        documentId: 'doc-1',
        actor: { type: 'CUSTOMER', id: 'u-1' },
      }),
    ).rejects.toThrow(TaxDocumentDownloadDeniedError);
  });
});

describe('TaxDocumentDownloadService — TTL handling', () => {
  it('uses env-default TTL when not supplied', async () => {
    const { service, prisma, pdfService } = makeService({
      TAX_DOWNLOAD_SIGNED_URL_TTL_SECONDS: 600,
    });
    prisma.taxDocument.findUnique.mockResolvedValue(makeDoc({ customerId: 'u-1' }));
    pdfService.getSignedDownloadUrl.mockResolvedValue({
      url: 'file:///x',
      documentNumber: 'SM-INV-000001',
    });
    const r = await service.issueDownloadUrl({
      documentId: 'doc-1',
      actor: { type: 'CUSTOMER', id: 'u-1' },
    });
    expect(r.expiresInSeconds).toBe(600);
    expect(pdfService.getSignedDownloadUrl).toHaveBeenCalledWith({
      documentId: 'doc-1',
      expiresInSeconds: 600,
    });
  });

  it('honours caller-supplied TTL override', async () => {
    const { service, prisma, pdfService } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(makeDoc({ customerId: 'u-1' }));
    pdfService.getSignedDownloadUrl.mockResolvedValue({
      url: 'file:///x',
      documentNumber: 'SM-INV-000001',
    });
    const r = await service.issueDownloadUrl({
      documentId: 'doc-1',
      actor: { type: 'CUSTOMER', id: 'u-1' },
      expiresInSeconds: 60,
    });
    expect(r.expiresInSeconds).toBe(60);
  });

  it('stamps urlExpiresAt on ALLOWED audits', async () => {
    const { service, prisma, pdfService } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(makeDoc({ customerId: 'u-1' }));
    pdfService.getSignedDownloadUrl.mockResolvedValue({
      url: 'file:///x',
      documentNumber: 'SM-INV-000001',
    });
    const before = Date.now();
    await service.issueDownloadUrl({
      documentId: 'doc-1',
      actor: { type: 'CUSTOMER', id: 'u-1' },
      expiresInSeconds: 300,
    });
    const auditArgs =
      prisma.taxDocumentDownloadAudit.create.mock.calls[0][0].data;
    expect(auditArgs.outcome).toBe('ALLOWED');
    expect(auditArgs.urlExpiresAt).toBeInstanceOf(Date);
    const delta =
      (auditArgs.urlExpiresAt as Date).getTime() - before - 300 * 1000;
    expect(Math.abs(delta)).toBeLessThan(2000);
  });
});

describe('TaxDocumentDownloadService — IP / UA capture', () => {
  it('captures ip + userAgent on ALLOWED audit', async () => {
    const { service, prisma, pdfService } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(makeDoc({ customerId: 'u-1' }));
    pdfService.getSignedDownloadUrl.mockResolvedValue({
      url: 'file:///x',
      documentNumber: 'SM-INV-000001',
    });
    await service.issueDownloadUrl({
      documentId: 'doc-1',
      actor: {
        type: 'CUSTOMER',
        id: 'u-1',
        ip: '203.0.113.42',
        userAgent: 'Mozilla/5.0 ...',
      },
    });
    const auditArgs =
      prisma.taxDocumentDownloadAudit.create.mock.calls[0][0].data;
    expect(auditArgs.ipAddress).toBe('203.0.113.42');
    expect(auditArgs.userAgent).toBe('Mozilla/5.0 ...');
  });
});
