import 'reflect-metadata';
import {
  EInvoiceService,
  EInvoiceCancellationWindowClosedError,
} from '../../src/modules/tax/application/services/einvoice.service';

// Phase 22 GST — EInvoiceService tests.
//
// Unit-level: prisma + env + provider are mocked. The applicability
// math is covered in tax-einvoice-applicability.spec.ts; these tests
// exercise the persistence + idempotency + cancellation-window logic.

function makeService(envOverrides: any = {}): {
  service: EInvoiceService;
  prisma: any;
  provider: any;
} {
  const prisma = {
    taxDocument: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    sellerGstin: { findUnique: jest.fn().mockResolvedValue(null) },
    taxDocumentLine: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const env: any = {
    getNumber: (key: string, fb: number) =>
      envOverrides[key] !== undefined ? envOverrides[key] : fb,
  };
  const provider: any = {
    name: 'stub',
    generate: jest.fn(),
    cancel: jest.fn(),
  };
  const service = new EInvoiceService(
    prisma as any,
    env,
    provider as any,
  );
  return { service, prisma, provider };
}

function makeDoc(o: any = {}) {
  return {
    id: 'doc-1',
    documentNumber: 'SM-INV-000001',
    documentType: 'TAX_INVOICE',
    documentTotalInPaise: 1_18_000n,
    taxableAmountInPaise: 1_00_000n,
    cgstAmountInPaise: 0n,
    sgstAmountInPaise: 0n,
    igstAmountInPaise: 18_000n,
    cessAmountInPaise: 0n,
    generatedAt: new Date(Date.UTC(2026, 3, 15, 10, 0, 0)),
    createdAt: new Date(Date.UTC(2026, 3, 15, 10, 0, 0)),
    supplierGstin: '29ABCDE1234F1Z5',
    buyerGstin: '07AAGCB1234C1Z5',
    status: 'GENERATED',
    einvoiceStatus: 'NOT_APPLICABLE',
    einvoiceRetryCount: 0,
    irn: null,
    ackNo: null,
    ackDate: null,
    ...o,
  };
}

describe('EInvoiceService.classifyForDocument', () => {
  it('throws on unknown document', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(null);
    await expect(
      service.classifyForDocument('nope'),
    ).rejects.toThrow(/not found/);
  });

  it('returns as-is when status already GENERATED (idempotent)', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ einvoiceStatus: 'GENERATED', irn: 'abc' }),
    );
    const r = await service.classifyForDocument('doc-1');
    expect(r.applicable).toBe(true);
    expect(prisma.taxDocument.update).not.toHaveBeenCalled();
  });

  it('marks NOT_APPLICABLE when B2C', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ buyerGstin: null, einvoiceStatus: 'NOT_APPLICABLE' }),
    );
    const r = await service.classifyForDocument('doc-1');
    expect(r.applicable).toBe(false);
    expect(r.reason).toMatch(/B2C/);
    expect(prisma.taxDocument.update).not.toHaveBeenCalled();
  });

  it('flips NOT_APPLICABLE → PENDING when supplier opted in', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ einvoiceStatus: 'NOT_APPLICABLE' }),
    );
    prisma.sellerGstin.findUnique.mockResolvedValue({
      aggregateTurnoverInPaise: 1_00_00_000n,
      einvoiceOptedIn: true,
    });
    prisma.taxDocument.update.mockImplementation(async (args: any) => ({
      ...makeDoc(),
      ...args.data,
    }));
    const r = await service.classifyForDocument('doc-1');
    expect(r.applicable).toBe(true);
    expect(r.document.einvoiceStatus).toBe('PENDING');
  });

  it('marks NOT_APPLICABLE when supplier below threshold + not opted in', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ einvoiceStatus: 'NOT_APPLICABLE' }),
    );
    prisma.sellerGstin.findUnique.mockResolvedValue({
      aggregateTurnoverInPaise: 1_00_00_000n,
      einvoiceOptedIn: false,
    });
    const r = await service.classifyForDocument('doc-1');
    expect(r.applicable).toBe(false);
  });
});

describe('EInvoiceService.generateForDocument', () => {
  it('throws EInvoiceNotApplicableError when classification says no', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ buyerGstin: null }), // B2C
    );
    await expect(
      service.generateForDocument('doc-1'),
    ).rejects.toThrow(/not eligible for IRP/);
  });

  it('is idempotent on already-GENERATED document', async () => {
    const { service, prisma, provider } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ einvoiceStatus: 'GENERATED', irn: 'existing-irn' }),
    );
    const r = await service.generateForDocument('doc-1');
    expect(r.irn).toBe('existing-irn');
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('calls provider + persists IRN fields on success', async () => {
    const { service, prisma, provider } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ einvoiceStatus: 'NOT_APPLICABLE' }),
    );
    prisma.sellerGstin.findUnique.mockResolvedValue({
      aggregateTurnoverInPaise: 1_00_00_000_00n,
      einvoiceOptedIn: true,
    });
    // First update: flip to PENDING via classifyForDocument.
    // Second update: flip to GENERATED after provider call.
    prisma.taxDocument.update
      .mockImplementationOnce(async (args: any) => ({
        ...makeDoc(),
        einvoiceStatus: 'PENDING',
        ...args.data,
      }))
      .mockImplementationOnce(async (args: any) => ({
        ...makeDoc(),
        ...args.data,
      }));
    provider.generate.mockResolvedValue({
      irn: 'a'.repeat(64),
      ackNo: 'STUB-123',
      ackDate: new Date('2026-04-15T10:00:00.000Z'),
      signedDocumentJson: { signature: 'X' },
      qrCodeUrl: 'data:image/svg+xml;base64,abc',
    });

    const r = await service.generateForDocument('doc-1');
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(r.irn).toBe('a'.repeat(64));
    expect(r.einvoiceStatus).toBe('GENERATED');
    expect(r.ackNo).toBe('STUB-123');
    expect(r.einvoiceProvider).toBe('stub');
  });

  it('on provider error: marks FAILED + increments retry_count + propagates', async () => {
    const { service, prisma, provider } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ einvoiceStatus: 'PENDING' }),
    );
    prisma.sellerGstin.findUnique.mockResolvedValue({
      aggregateTurnoverInPaise: 1_00_00_000_00n,
      einvoiceOptedIn: true,
    });
    prisma.taxDocument.update.mockImplementationOnce(async (args: any) => ({
      ...makeDoc({ einvoiceStatus: 'FAILED', einvoiceRetryCount: 1 }),
      ...args.data,
    }));
    provider.generate.mockRejectedValue(new Error('NIC 503'));

    await expect(
      service.generateForDocument('doc-1'),
    ).rejects.toThrow(/NIC 503/);
    const failArgs = prisma.taxDocument.update.mock.calls[0][0];
    expect(failArgs.data.einvoiceStatus).toBe('FAILED');
    expect(failArgs.data.einvoiceFailureReason).toBe('NIC 503');
    expect(failArgs.data.einvoiceRetryCount).toEqual({ increment: 1 });
  });
});

describe('EInvoiceService.cancelForDocument', () => {
  it('throws on unknown document', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(null);
    await expect(
      service.cancelForDocument({
        documentId: 'nope',
        cancellationCode: 4,
        cancellationReason: 'r',
      }),
    ).rejects.toThrow(/not found/);
  });

  it('refuses to cancel a non-GENERATED IRN', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ einvoiceStatus: 'PENDING', irn: null, ackDate: null }),
    );
    await expect(
      service.cancelForDocument({
        documentId: 'doc-1',
        cancellationCode: 4,
        cancellationReason: 'r',
      }),
    ).rejects.toThrow(/nothing to cancel/);
  });

  it('refuses cancellation past the 24-hour CBIC window', async () => {
    const { service, prisma } = makeService();
    const ackDate = new Date('2026-04-10T10:00:00.000Z');
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({
        einvoiceStatus: 'GENERATED',
        irn: 'i'.repeat(64),
        ackDate,
      }),
    );
    await expect(
      service.cancelForDocument({
        documentId: 'doc-1',
        cancellationCode: 4,
        cancellationReason: 'duplicate',
        now: new Date('2026-04-13T10:00:00.000Z'),
      }),
    ).rejects.toThrow(EInvoiceCancellationWindowClosedError);
  });

  it('cancels within window + flips status to NOT_APPLICABLE', async () => {
    const { service, prisma, provider } = makeService();
    const ackDate = new Date('2026-04-15T08:00:00.000Z');
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({
        einvoiceStatus: 'GENERATED',
        irn: 'i'.repeat(64),
        ackDate,
      }),
    );
    provider.cancel.mockResolvedValue({
      cancelledAt: new Date('2026-04-15T10:00:00.000Z'),
      signedDocumentJson: { provider: 'stub', cancelledAt: 'x' },
    });
    prisma.taxDocument.update.mockImplementation(async (args: any) => ({
      ...makeDoc(),
      ...args.data,
    }));

    const r = await service.cancelForDocument({
      documentId: 'doc-1',
      cancellationCode: 1, // duplicate
      cancellationReason: 'duplicate',
      now: new Date('2026-04-15T10:00:00.000Z'),
    });
    expect(provider.cancel).toHaveBeenCalledWith({
      irn: 'i'.repeat(64),
      cancellationCode: 1,
      cancellationReason: 'duplicate',
    });
    expect(r.einvoiceStatus).toBe('NOT_APPLICABLE');
  });
});
