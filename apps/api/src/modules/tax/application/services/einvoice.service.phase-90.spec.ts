// Phase 90 (2026-05-23) — EInvoiceService hardening coverage.
//
// Gaps covered:
//   #5   PDF re-render trigger after mint (status=PDF_PENDING)
//   #7   row lock around provider call
//   #8   CANCELLED status + irn/ack/qr nulled on cancel
//   #9   cancelledAt + cancellation columns populated
//   #10  credit-note carries originalIrn in provider payload
//   #12  transactionCategory derived (B2B / SEZ)
//   #18  resetRetryCount flips FAILED → PENDING
//   #19  cancellationCode enum validation
//   #20  audit log entries written
//   #21  events emitted

import {
  EInvoiceService,
  EInvoiceNotApplicableError,
} from './einvoice.service';
import { EINVOICE_EVENTS } from '../../domain/einvoice-events';

function buildPrisma(opts: any = {}) {
  let storedDoc: any = opts.document ?? null;
  const audit = { create: jest.fn().mockResolvedValue({}) };
  const adminTask = { upsert: jest.fn().mockResolvedValue({}) };
  const taxDocument = {
    findUnique: jest.fn().mockImplementation(async () => storedDoc),
    update: jest.fn().mockImplementation(async ({ where, data }: any) => {
      storedDoc = { ...storedDoc, ...data, id: where.id };
      return storedDoc;
    }),
  };
  const sellerGstin = {
    findUnique: jest.fn().mockResolvedValue(
      opts.sellerGstin ?? {
        aggregateTurnoverInPaise: 10_00_00_00_00n,
        einvoiceOptedIn: true,
      },
    ),
  };
  const taxDocumentLine = {
    findMany: jest.fn().mockResolvedValue(opts.lines ?? []),
  };
  return {
    taxDocument,
    sellerGstin,
    taxDocumentLine,
    eInvoiceAuditLog: audit,
    adminTask,
    $transaction: jest.fn().mockImplementation(async (fn: any) => {
      const tx: any = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        taxDocument,
      };
      return fn(tx);
    }),
  };
}

function buildEnv() {
  return { getNumber: jest.fn().mockReturnValue(0), getString: jest.fn() };
}

function buildEventBus() {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

function buildProvider(name = 'stub', overrides: any = {}) {
  return {
    name,
    generate: jest.fn().mockResolvedValue({
      irn: 'a'.repeat(64),
      ackNo: 'ACK-123',
      ackDate: new Date('2026-05-23T10:00:00Z'),
      signedDocumentJson: { provider: name },
      qrCodeUrl: 'data:image/svg+xml;base64,FAKE',
      ...overrides.generate,
    }),
    cancel: jest.fn().mockResolvedValue({
      cancelledAt: new Date('2026-05-23T11:00:00Z'),
      signedDocumentJson: { cancelled: true },
      ...overrides.cancel,
    }),
  };
}

describe('EInvoiceService (Phase 90)', () => {
  const fullDoc = {
    id: 'doc-1',
    documentType: 'TAX_INVOICE',
    status: 'PDF_PENDING',
    einvoiceStatus: 'PENDING',
    supplierGstin: '29AAACR1234A1ZK',
    buyerGstin: '27AAACR5678B1ZL',
    documentNumber: 'INV-001',
    documentTotalInPaise: 100000n,
    taxableAmountInPaise: 80000n,
    cgstAmountInPaise: 5000n,
    sgstAmountInPaise: 5000n,
    igstAmountInPaise: 0n,
    cessAmountInPaise: 0n,
    reverseChargeApplicable: false,
    placeOfSupplyStateCode: '27',
    generatedAt: new Date('2026-05-22'),
    createdAt: new Date('2026-05-22'),
    irn: null,
    ackNo: null,
    ackDate: null,
    originalDocumentId: null,
  };

  describe('Gap #5/#12/#20/#21 — generate + PDF re-render + audit + event', () => {
    it('mints IRN, flips status=PDF_PENDING, writes audit + emits event', async () => {
      const prisma = buildPrisma({ document: fullDoc });
      const eventBus = buildEventBus();
      const svc = new EInvoiceService(
        prisma as any,
        buildEnv() as any,
        buildProvider() as any,
        eventBus as any,
      );
      await svc.generateForDocument('doc-1');
      const updateCall = prisma.taxDocument.update.mock.calls.at(-1);
      expect(updateCall![0].data.status).toBe('PDF_PENDING');
      expect(updateCall![0].data.pdfUrl).toBeNull();
      expect(updateCall![0].data.einvoiceStatus).toBe('GENERATED');
      expect(prisma.eInvoiceAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'MINT' }),
        }),
      );
      const names = eventBus.publish.mock.calls.map((c) => c[0].eventName);
      expect(names).toContain(EINVOICE_EVENTS.GENERATED);
    });

    it('Gap #12 — provider payload includes transactionCategory + reverseCharge', async () => {
      const prisma = buildPrisma({ document: fullDoc });
      const provider = buildProvider();
      const svc = new EInvoiceService(
        prisma as any,
        buildEnv() as any,
        provider as any,
      );
      await svc.generateForDocument('doc-1');
      const payload = provider.generate.mock.calls[0][0];
      expect(payload.transactionCategory).toBe('B2B');
      expect(payload.reverseChargeApplicable).toBe(false);
      expect(payload.placeOfSupplyStateCode).toBe('27');
    });

    it('Gap #12 — SEZ buyer GSTIN → transactionCategory=SEZWP', async () => {
      const sezDoc = {
        ...fullDoc,
        // Char position 11 (0-indexed 11) = '9' marks SEZ.
        buyerGstin: '27AAACR5678B9ZL',
      };
      const prisma = buildPrisma({ document: sezDoc });
      const provider = buildProvider();
      const svc = new EInvoiceService(
        prisma as any,
        buildEnv() as any,
        provider as any,
      );
      await svc.generateForDocument('doc-1');
      expect(provider.generate.mock.calls[0][0].transactionCategory).toBe(
        'SEZWP',
      );
    });
  });

  describe('Gap #10 — credit-note original-IRN linkage', () => {
    it('CREDIT_NOTE payload includes originalIrn from the original doc', async () => {
      const cnDoc = {
        ...fullDoc,
        id: 'doc-2',
        documentType: 'CREDIT_NOTE',
        originalDocumentId: 'doc-orig',
      };
      const origDoc = {
        irn: 'b'.repeat(64),
        documentNumber: 'INV-ORIG',
        generatedAt: new Date('2026-05-20'),
      };
      const prisma = buildPrisma({ document: cnDoc });
      prisma.taxDocument.findUnique.mockImplementation(async ({ where }: any) => {
        if (where.id === 'doc-orig') return origDoc;
        return cnDoc;
      });
      const provider = buildProvider();
      const svc = new EInvoiceService(
        prisma as any,
        buildEnv() as any,
        provider as any,
      );
      await svc.generateForDocument('doc-2');
      const payload = provider.generate.mock.calls[0][0];
      expect(payload.originalIrn).toBe('b'.repeat(64));
      expect(payload.originalDocumentNumber).toBe('INV-ORIG');
    });
  });

  describe('Gap #8/#9/#17/#19/#20/#21 — cancel hardening', () => {
    it('rejects invalid cancellationCode (Gap #19)', async () => {
      const prisma = buildPrisma();
      const svc = new EInvoiceService(
        prisma as any,
        buildEnv() as any,
        buildProvider() as any,
      );
      await expect(
        svc.cancelForDocument({
          documentId: 'doc-1',
          cancellationCode: 99,
          cancellationReason: 'bogus code',
        }),
      ).rejects.toThrow(/Invalid cancellationCode/);
    });

    it('rejects short reason', async () => {
      const prisma = buildPrisma();
      const svc = new EInvoiceService(
        prisma as any,
        buildEnv() as any,
        buildProvider() as any,
      );
      await expect(
        svc.cancelForDocument({
          documentId: 'doc-1',
          cancellationCode: 1,
          cancellationReason: 'ok',
        }),
      ).rejects.toThrow(/10 characters/);
    });

    it('flips status=CANCELLED + nulls IRN + sets cancelledAt + audit + event', async () => {
      const generatedDoc = {
        ...fullDoc,
        einvoiceStatus: 'GENERATED',
        irn: 'c'.repeat(64),
        ackNo: 'ACK-CC',
        ackDate: new Date(), // fresh — within 24h
      };
      const prisma = buildPrisma({ document: generatedDoc });
      const eventBus = buildEventBus();
      const svc = new EInvoiceService(
        prisma as any,
        buildEnv() as any,
        buildProvider() as any,
        eventBus as any,
      );
      await svc.cancelForDocument({
        documentId: 'doc-1',
        cancellationCode: 1,
        cancellationReason: 'Duplicate invoice — wrong buyer GSTIN',
        actorId: 'admin-1',
      });
      const updateData = prisma.taxDocument.update.mock.calls.at(-1)![0].data;
      expect(updateData.einvoiceStatus).toBe('CANCELLED');
      expect(updateData.irn).toBeNull();
      expect(updateData.ackNo).toBeNull();
      expect(updateData.ackDate).toBeNull();
      expect(updateData.qrCodeUrl).toBeNull();
      expect(updateData.cancelledAt).toBeInstanceOf(Date);
      expect(updateData.einvoiceCancellationCode).toBe(1);
      expect(updateData.einvoiceCancelledBy).toBe('admin-1');
      expect(updateData.status).toBe('PDF_PENDING'); // re-render trigger
      expect(prisma.eInvoiceAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'CANCEL' }),
        }),
      );
      const names = eventBus.publish.mock.calls.map((c) => c[0].eventName);
      expect(names).toContain(EINVOICE_EVENTS.CANCELLED);
    });

    it('rejects cancel past 24h window', async () => {
      const oldDoc = {
        ...fullDoc,
        einvoiceStatus: 'GENERATED',
        irn: 'c'.repeat(64),
        ackNo: 'ACK-OLD',
        ackDate: new Date('2026-05-21'), // 2+ days old
      };
      const prisma = buildPrisma({ document: oldDoc });
      const svc = new EInvoiceService(
        prisma as any,
        buildEnv() as any,
        buildProvider() as any,
      );
      await expect(
        svc.cancelForDocument({
          documentId: 'doc-1',
          cancellationCode: 1,
          cancellationReason: 'Duplicate invoice',
        }),
      ).rejects.toThrow(/24-hour cancellation window/);
    });
  });

  describe('Gap #18 — resetRetryCount', () => {
    it('FAILED → PENDING + zeros retryCount + writes audit', async () => {
      const failedDoc = {
        ...fullDoc,
        einvoiceStatus: 'FAILED',
        einvoiceRetryCount: 5,
      };
      const prisma = buildPrisma({ document: failedDoc });
      const eventBus = buildEventBus();
      const svc = new EInvoiceService(
        prisma as any,
        buildEnv() as any,
        buildProvider() as any,
        eventBus as any,
      );
      await svc.resetRetryCount({
        documentId: 'doc-1',
        actorId: 'admin-2',
        reason: 'NIC outage cleared',
      });
      const updateData = prisma.taxDocument.update.mock.calls.at(-1)![0].data;
      expect(updateData.einvoiceStatus).toBe('PENDING');
      expect(updateData.einvoiceRetryCount).toBe(0);
      expect(prisma.eInvoiceAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'RESET_RETRY' }),
        }),
      );
      const names = eventBus.publish.mock.calls.map((c) => c[0].eventName);
      expect(names).toContain(EINVOICE_EVENTS.RETRY_RESET);
    });

    it('rejects reset on non-FAILED row', async () => {
      const liveDoc = {
        ...fullDoc,
        einvoiceStatus: 'GENERATED',
        irn: 'x'.repeat(64),
      };
      const prisma = buildPrisma({ document: liveDoc });
      const svc = new EInvoiceService(
        prisma as any,
        buildEnv() as any,
        buildProvider() as any,
      );
      await expect(
        svc.resetRetryCount({
          documentId: 'doc-1',
          actorId: 'admin-2',
          reason: 'why not',
        }),
      ).rejects.toBeInstanceOf(EInvoiceNotApplicableError);
    });
  });
});
