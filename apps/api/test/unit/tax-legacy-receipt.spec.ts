import 'reflect-metadata';
import { LegacyReceiptService } from '../../src/modules/tax/application/services/legacy-receipt.service';

// Phase 14 GST — LegacyReceiptService tests.
//
// Unit-level: prisma + DocumentSequenceService are mocked. The DB-side
// invariants (PLATFORM-scoped sequence increments, FK enforcement)
// are exercised by Phase 27 integration tests.

interface MockPrisma {
  taxDocument: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
  taxDocumentLine: {
    create: jest.Mock;
  };
  subOrder: {
    findUnique: jest.Mock;
  };
  orderItem: {
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
}

interface MockDocSequence {
  nextNumber: jest.Mock;
}

function makeService(): {
  service: LegacyReceiptService;
  prisma: MockPrisma;
  docSequence: MockDocSequence;
} {
  const prisma: MockPrisma = {
    taxDocument: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    taxDocumentLine: {
      create: jest.fn(),
    },
    subOrder: {
      findUnique: jest.fn(),
    },
    orderItem: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const docSequence: MockDocSequence = {
    nextNumber: jest.fn(),
  };
  const service = new LegacyReceiptService(prisma as any, docSequence as any);
  return { service, prisma, docSequence };
}

describe('LegacyReceiptService.isLegacyOrder', () => {
  it('returns false when a real invoice exists', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findFirst.mockResolvedValue({
      id: 'doc-1',
      documentType: 'TAX_INVOICE',
    });
    expect(await service.isLegacyOrder('sub-1')).toBe(false);
  });

  it('returns false when a BILL_OF_SUPPLY exists', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findFirst.mockResolvedValue({
      id: 'doc-1',
      documentType: 'BILL_OF_SUPPLY',
    });
    expect(await service.isLegacyOrder('sub-1')).toBe(false);
  });

  it('treats existing LEGACY_RECEIPT as still legacy (idempotent re-check)', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findFirst.mockResolvedValue({
      id: 'doc-1',
      documentType: 'LEGACY_RECEIPT',
    });
    prisma.orderItem.findMany.mockResolvedValue([
      { id: 'oi-1', taxSnapshot: null },
    ]);
    expect(await service.isLegacyOrder('sub-1')).toBe(true);
  });

  it('returns false when at least one item has a tax snapshot (mid-checkout)', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findFirst.mockResolvedValue(null);
    prisma.orderItem.findMany.mockResolvedValue([
      { id: 'oi-1', taxSnapshot: { id: 'snap-1' } },
      { id: 'oi-2', taxSnapshot: null },
    ]);
    expect(await service.isLegacyOrder('sub-1')).toBe(false);
  });

  it('returns true when no doc + no snapshots', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findFirst.mockResolvedValue(null);
    prisma.orderItem.findMany.mockResolvedValue([
      { id: 'oi-1', taxSnapshot: null },
      { id: 'oi-2', taxSnapshot: null },
    ]);
    expect(await service.isLegacyOrder('sub-1')).toBe(true);
  });

  it('returns false on a pathological zero-item sub-order', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findFirst.mockResolvedValue(null);
    prisma.orderItem.findMany.mockResolvedValue([]);
    expect(await service.isLegacyOrder('sub-1')).toBe(false);
  });
});

describe('LegacyReceiptService.generateForSubOrder', () => {
  function withSubOrder(prisma: MockPrisma) {
    prisma.subOrder.findUnique.mockResolvedValue({
      id: 'sub-1',
      masterOrderId: 'mo-1',
      sellerId: 'seller-1',
      subTotalInPaise: 250_00n,
      masterOrder: {
        id: 'mo-1',
        customerId: 'u-1',
        customer: {
          firstName: 'Asha',
          lastName: 'Iyer',
          email: 'asha@example.com',
        },
      },
      items: [
        {
          id: 'oi-1',
          productId: 'p-1',
          variantId: 'v-1',
          productTitle: 'Cricket Bat',
          variantTitle: 'Senior',
          quantity: 1,
          unitPriceInPaise: 200_00n,
          totalPriceInPaise: 200_00n,
        },
        {
          id: 'oi-2',
          productId: 'p-2',
          variantId: null,
          productTitle: 'Grip Tape',
          variantTitle: null,
          quantity: 1,
          unitPriceInPaise: 50_00n,
          totalPriceInPaise: 50_00n,
        },
      ],
    });
  }

  it('returns existing receipt on idempotent re-call', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findFirst.mockResolvedValueOnce({
      id: 'doc-existing',
      documentNumber: 'SM-LR-000001',
      documentTotalInPaise: 250_00n,
      status: 'GENERATED',
    });
    const result = await service.generateForSubOrder('sub-1');
    expect(result.isNew).toBe(false);
    expect(result.document.id).toBe('doc-existing');
    expect(prisma.taxDocument.create).not.toHaveBeenCalled();
  });

  it('refuses when a real TAX_INVOICE already exists', async () => {
    const { service, prisma } = makeService();
    // First findFirst: no existing LEGACY_RECEIPT.
    // Second findFirst: a real invoice was issued.
    prisma.taxDocument.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'doc-real',
        documentType: 'TAX_INVOICE',
        documentNumber: 'SM-INV-000042',
      });
    await expect(
      service.generateForSubOrder('sub-1'),
    ).rejects.toThrow(/already has a TAX_INVOICE/);
  });

  it('throws on unknown sub-order', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findFirst
      .mockResolvedValueOnce(null) // no existing LEGACY_RECEIPT
      .mockResolvedValueOnce(null); // no real invoice
    prisma.subOrder.findUnique.mockResolvedValue(null);
    await expect(
      service.generateForSubOrder('nope'),
    ).rejects.toThrow(/not found/);
  });

  it('throws on sub-order with zero items', async () => {
    const { service, prisma } = makeService();
    prisma.taxDocument.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.subOrder.findUnique.mockResolvedValue({
      id: 'sub-1',
      masterOrderId: 'mo-1',
      sellerId: 'seller-1',
      masterOrder: { id: 'mo-1', customerId: 'u-1', customer: null },
      items: [],
    });
    await expect(
      service.generateForSubOrder('sub-1'),
    ).rejects.toThrow(/no items/);
  });

  it('creates LEGACY_RECEIPT with zero tax + correct gross total', async () => {
    const { service, prisma, docSequence } = makeService();
    prisma.taxDocument.findFirst
      .mockResolvedValueOnce(null) // no existing LEGACY_RECEIPT
      .mockResolvedValueOnce(null); // no real invoice
    withSubOrder(prisma);
    docSequence.nextNumber.mockResolvedValue({
      documentNumber: 'SM-LR-000001',
      sequenceKey: 'PLATFORM|2026-27|LEGACY_RECEIPT',
      lastNumber: 1,
      prefix: 'SM-LR',
      supplierGstin: null,
      financialYear: '2026-27',
      documentType: 'LEGACY_RECEIPT',
    });
    prisma.taxDocument.create.mockImplementation(async (args: any) => ({
      id: 'doc-new',
      ...args.data,
    }));

    const result = await service.generateForSubOrder('sub-1');
    expect(result.isNew).toBe(true);
    expect(result.document.documentNumber).toBe('SM-LR-000001');
    expect(result.document.documentTotalInPaise).toBe(250_00n);
    expect(result.document.status).toBe('GENERATED');

    // PLATFORM-scoped sequence
    expect(docSequence.nextNumber).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierGstin: null,
        documentType: 'LEGACY_RECEIPT',
      }),
    );

    // tax_document row built with zero tax + supplier nulls
    const createArgs = prisma.taxDocument.create.mock.calls[0][0].data;
    expect(createArgs.documentType).toBe('LEGACY_RECEIPT');
    expect(createArgs.supplierGstin).toBeNull();
    expect(createArgs.supplierType).toBe('SPORTSMART');
    expect(createArgs.taxableAmountInPaise).toBe(0n);
    expect(createArgs.cgstAmountInPaise).toBe(0n);
    expect(createArgs.sgstAmountInPaise).toBe(0n);
    expect(createArgs.igstAmountInPaise).toBe(0n);
    expect(createArgs.totalTaxAmountInPaise).toBe(0n);
    expect(createArgs.documentTotalInPaise).toBe(250_00n);
    expect(createArgs.einvoiceStatus).toBe('NOT_APPLICABLE');
    expect(createArgs.status).toBe('GENERATED');
    expect(createArgs.invoiceType).toBeNull();
    expect(createArgs.buyerLegalName).toBe('Asha Iyer');

    // Two line rows
    expect(prisma.taxDocumentLine.create).toHaveBeenCalledTimes(2);
    const line1 = prisma.taxDocumentLine.create.mock.calls[0][0].data;
    expect(line1.lineNumber).toBe(1);
    expect(line1.gstRateBps).toBe(0);
    expect(line1.taxableAmountInPaise).toBe(0n);
    expect(line1.cgstAmountInPaise).toBe(0n);
    expect(line1.hsnOrSacCode).toBeNull();
    expect(line1.uqcCode).toBeNull();
    expect(line1.productName).toBe('Cricket Bat — Senior');
    expect(line1.lineTotalInPaise).toBe(200_00n);
  });

  it('falls back to email when customer name is missing', async () => {
    const { service, prisma, docSequence } = makeService();
    prisma.taxDocument.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.subOrder.findUnique.mockResolvedValue({
      id: 'sub-2',
      masterOrderId: 'mo-2',
      sellerId: null,
      masterOrder: {
        id: 'mo-2',
        customerId: 'u-2',
        customer: { firstName: '', lastName: '', email: 'anon@example.com' },
      },
      items: [
        {
          id: 'oi-1',
          productId: 'p-1',
          variantId: null,
          productTitle: 'Item',
          variantTitle: null,
          quantity: 2,
          unitPriceInPaise: 100_00n,
          totalPriceInPaise: 200_00n,
        },
      ],
    });
    docSequence.nextNumber.mockResolvedValue({
      documentNumber: 'SM-LR-000002',
      lastNumber: 2,
      prefix: 'SM-LR',
      supplierGstin: null,
      financialYear: '2026-27',
      documentType: 'LEGACY_RECEIPT',
      sequenceKey: 'PLATFORM|2026-27|LEGACY_RECEIPT',
    });
    prisma.taxDocument.create.mockImplementation(async (args: any) => ({
      id: 'doc-2',
      ...args.data,
    }));

    const result = await service.generateForSubOrder('sub-2');
    expect(result.isNew).toBe(true);
    expect(
      prisma.taxDocument.create.mock.calls[0][0].data.buyerLegalName,
    ).toBe('anon@example.com');
  });
});
