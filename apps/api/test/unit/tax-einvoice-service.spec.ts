import 'reflect-metadata';
import {
  EInvoiceService,
  EInvoiceCancellationWindowClosedError,
  EInvoiceDisabledError,
} from '../../src/modules/tax/application/services/einvoice.service';
import { EInvoiceProviderError } from '../../src/modules/tax/infrastructure/einvoice/einvoice-provider';

// Phase 22 GST — EInvoiceService tests (refreshed for the Phase 90 +
// Phase 160 hardening: SELECT-FOR-UPDATE lock, audit-log table, CANCELLED
// terminal state, the einvoice_enabled kill switch, generatedBy actor, and
// typed-provider-error code capture).
//
// Unit-level: prisma + env + provider (+ optional taxConfig) are mocked.

function makeService(opts: {
  envOverrides?: any;
  /** When set, a TaxConfigService mock is wired so the kill switch engages. */
  einvoiceEnabled?: boolean;
} = {}): {
  service: EInvoiceService;
  prisma: any;
  provider: any;
} {
  const envOverrides = opts.envOverrides ?? {};
  const taxDocument = {
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const prisma: any = {
    taxDocument,
    sellerGstin: { findUnique: jest.fn().mockResolvedValue(null) },
    taxDocumentLine: { findMany: jest.fn().mockResolvedValue([]) },
    // Phase 90 — chain-of-custody audit table + classify AdminTask upsert.
    eInvoiceAuditLog: { create: jest.fn().mockResolvedValue({}) },
    adminTask: { upsert: jest.fn().mockResolvedValue({}) },
    // Phase 90 — SELECT … FOR UPDATE lock around the provider call.
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (cb: any) =>
      cb({ $queryRaw: jest.fn().mockResolvedValue([]), taxDocument }),
    ),
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
  const taxConfig =
    opts.einvoiceEnabled === undefined
      ? undefined
      : { getBoolean: jest.fn().mockResolvedValue(opts.einvoiceEnabled), getNumber: jest.fn() };
  const service = new EInvoiceService(
    prisma as any,
    env,
    provider as any,
    undefined, // eventBus
    taxConfig as any,
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
    reverseChargeApplicable: false,
    placeOfSupplyStateCode: '07',
    originalDocumentId: null,
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
    await expect(service.classifyForDocument('nope')).rejects.toThrow(/not found/);
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
});

describe('EInvoiceService.generateForDocument', () => {
  it('throws EInvoiceNotApplicableError when classification says no', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(makeDoc({ buyerGstin: null }));
    await expect(service.generateForDocument('doc-1')).rejects.toThrow(
      /not eligible for IRP/,
    );
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

  it('calls provider + persists IRN fields + generatedBy on success', async () => {
    const { service, prisma, provider } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ einvoiceStatus: 'PENDING' }),
    );
    prisma.sellerGstin.findUnique.mockResolvedValue({
      aggregateTurnoverInPaise: 1_00_00_000_00n,
      einvoiceOptedIn: true,
    });
    prisma.taxDocument.update.mockImplementation(async (args: any) => ({
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

    const r = await service.generateForDocument('doc-1', { actorId: 'admin-7', actorRole: 'ADMIN' });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(r.irn).toBe('a'.repeat(64));
    expect(r.einvoiceStatus).toBe('GENERATED');
    expect(r.einvoiceProvider).toBe('stub');
    // Phase 160 — the GENERATED update records who/when minted.
    const genUpdate = prisma.taxDocument.update.mock.calls
      .map((c: any) => c[0].data)
      .find((d: any) => d.einvoiceStatus === 'GENERATED');
    expect(genUpdate.einvoiceGeneratedBy).toBe('admin-7');
    expect(genUpdate.einvoiceGeneratedAt).toBeInstanceOf(Date);
    expect(genUpdate.einvoiceErrorCode).toBeNull();
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
    prisma.taxDocument.update.mockImplementation(async (args: any) => ({
      ...makeDoc(),
      ...args.data,
    }));
    provider.generate.mockRejectedValue(new Error('NIC 503'));

    await expect(service.generateForDocument('doc-1')).rejects.toThrow(/NIC 503/);
    const failData = prisma.taxDocument.update.mock.calls
      .map((c: any) => c[0].data)
      .find((d: any) => d.einvoiceStatus === 'FAILED');
    expect(failData.einvoiceFailureReason).toBe('NIC 503');
    expect(failData.einvoiceRetryCount).toEqual({ increment: 1 });
  });

  // Phase 160 (#8) — a typed provider error persists the NIC error code.
  it('captures the NIC error code from a typed provider error', async () => {
    const { service, prisma, provider } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ einvoiceStatus: 'PENDING' }),
    );
    prisma.sellerGstin.findUnique.mockResolvedValue({
      aggregateTurnoverInPaise: 1_00_00_000_00n,
      einvoiceOptedIn: true,
    });
    prisma.taxDocument.update.mockImplementation(async (args: any) => ({
      ...makeDoc(),
      ...args.data,
    }));
    provider.generate.mockRejectedValue(
      new EInvoiceProviderError('mandatory field missing', 'PERMANENT', {
        nicErrorCode: '2253',
      }),
    );
    await expect(service.generateForDocument('doc-1')).rejects.toBeInstanceOf(
      EInvoiceProviderError,
    );
    const failData = prisma.taxDocument.update.mock.calls
      .map((c: any) => c[0].data)
      .find((d: any) => d.einvoiceStatus === 'FAILED');
    expect(failData.einvoiceErrorCode).toBe('2253');
  });

  // Phase 160 (#2) — the kill switch blocks minting at runtime.
  it('throws EInvoiceDisabledError + never calls the provider when disabled', async () => {
    const { service, provider, prisma } = makeService({ einvoiceEnabled: false });
    prisma.taxDocument.findUnique.mockResolvedValue(makeDoc({ einvoiceStatus: 'PENDING' }));
    await expect(service.generateForDocument('doc-1')).rejects.toBeInstanceOf(
      EInvoiceDisabledError,
    );
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('proceeds when the kill switch is enabled', async () => {
    const { service, provider, prisma } = makeService({ einvoiceEnabled: true });
    prisma.taxDocument.findUnique.mockResolvedValue(makeDoc({ einvoiceStatus: 'PENDING' }));
    prisma.sellerGstin.findUnique.mockResolvedValue({
      aggregateTurnoverInPaise: 1_00_00_000_00n,
      einvoiceOptedIn: true,
    });
    prisma.taxDocument.update.mockImplementation(async (args: any) => ({ ...makeDoc(), ...args.data }));
    provider.generate.mockResolvedValue({
      irn: 'b'.repeat(64),
      ackNo: 'STUB-9',
      ackDate: new Date('2026-04-15T10:00:00.000Z'),
      signedDocumentJson: {},
      qrCodeUrl: '',
    });
    await service.generateForDocument('doc-1');
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
});

describe('EInvoiceService.isEnabled', () => {
  it('defaults to enabled when no TaxConfigService is wired', async () => {
    const { service } = makeService();
    expect(await service.isEnabled()).toBe(true);
  });
  it('respects the tax-config flag when wired', async () => {
    const { service } = makeService({ einvoiceEnabled: false });
    expect(await service.isEnabled()).toBe(false);
  });
});

describe('EInvoiceService.cancelForDocument', () => {
  const REASON = 'duplicate invoice entry'; // ≥10 chars (Phase 90 validation)

  it('throws on unknown document', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(null);
    await expect(
      service.cancelForDocument({ documentId: 'nope', cancellationCode: 4, cancellationReason: REASON }),
    ).rejects.toThrow(/not found/);
  });

  it('rejects an invalid cancellation code', async () => {
    const { service } = makeService();
    await expect(
      service.cancelForDocument({ documentId: 'doc-1', cancellationCode: 9, cancellationReason: REASON }),
    ).rejects.toThrow(/Invalid cancellationCode/);
  });

  it('rejects a too-short reason', async () => {
    const { service } = makeService();
    await expect(
      service.cancelForDocument({ documentId: 'doc-1', cancellationCode: 4, cancellationReason: 'short' }),
    ).rejects.toThrow(/at least 10 characters/);
  });

  it('refuses to cancel a non-GENERATED IRN', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ einvoiceStatus: 'PENDING', irn: null, ackDate: null }),
    );
    await expect(
      service.cancelForDocument({ documentId: 'doc-1', cancellationCode: 4, cancellationReason: REASON }),
    ).rejects.toThrow(/nothing to cancel/);
  });

  it('refuses cancellation past the 24-hour CBIC window', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ einvoiceStatus: 'GENERATED', irn: 'i'.repeat(64), ackDate: new Date('2026-04-10T10:00:00.000Z') }),
    );
    await expect(
      service.cancelForDocument({
        documentId: 'doc-1',
        cancellationCode: 4,
        cancellationReason: REASON,
        now: new Date('2026-04-13T10:00:00.000Z'),
      }),
    ).rejects.toThrow(EInvoiceCancellationWindowClosedError);
  });

  it('cancels within window + flips status to CANCELLED + sets cancelledAt + reason cols', async () => {
    const { service, prisma, provider } = makeService();
    prisma.taxDocument.findUnique.mockResolvedValue(
      makeDoc({ einvoiceStatus: 'GENERATED', irn: 'i'.repeat(64), ackDate: new Date('2026-04-15T08:00:00.000Z') }),
    );
    provider.cancel.mockResolvedValue({
      cancelledAt: new Date('2026-04-15T10:00:00.000Z'),
      signedDocumentJson: { provider: 'stub' },
    });
    prisma.taxDocument.update.mockImplementation(async (args: any) => ({ ...makeDoc(), ...args.data }));

    const r = await service.cancelForDocument({
      documentId: 'doc-1',
      cancellationCode: 1,
      cancellationReason: REASON,
      actorId: 'admin-3',
      now: new Date('2026-04-15T10:00:00.000Z'),
    });
    expect(provider.cancel).toHaveBeenCalledWith({
      irn: 'i'.repeat(64),
      cancellationCode: 1,
      cancellationReason: REASON,
    });
    // Phase 90/160 — CANCELLED terminal (not NOT_APPLICABLE) + queryable cols.
    expect(r.einvoiceStatus).toBe('CANCELLED');
    const cancelData = prisma.taxDocument.update.mock.calls[0][0].data;
    expect(cancelData.einvoiceStatus).toBe('CANCELLED');
    expect(cancelData.cancelledAt).toBeInstanceOf(Date);
    expect(cancelData.einvoiceCancellationCode).toBe(1);
    expect(cancelData.einvoiceCancellationReason).toBe(REASON);
    expect(cancelData.einvoiceCancelledBy).toBe('admin-3');
  });
});
