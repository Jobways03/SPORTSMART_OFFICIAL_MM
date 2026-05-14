import 'reflect-metadata';
import { EWayBillService } from '../../src/modules/tax/application/services/eway-bill.service';

// Phase 15 GST — EWayBillService tests.
//
// Unit-level: prisma + TaxConfig + provider are mocked. The DB-side
// invariants (partial unique on active row per sub-order, FK
// enforcement) are exercised by Phase 27 integration tests.

interface MockPrisma {
  eWayBill: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  taxDocument: { findFirst: jest.Mock; findUnique: jest.Mock };
  subOrder: { findUnique: jest.Mock };
  orderItem: { findMany: jest.Mock };
}

interface MockTaxConfig {
  getNumber: jest.Mock;
}

interface MockProvider {
  name: string;
  generate: jest.Mock;
  cancel: jest.Mock;
}

function makeService(opts: { threshold?: number } = {}): {
  service: EWayBillService;
  prisma: MockPrisma;
  taxConfig: MockTaxConfig;
  provider: MockProvider;
} {
  const prisma: MockPrisma = {
    eWayBill: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    taxDocument: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    subOrder: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    orderItem: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const taxConfig: MockTaxConfig = {
    getNumber: jest.fn().mockResolvedValue(opts.threshold ?? 50_00_00),
  };
  const provider: MockProvider = {
    name: 'stub',
    generate: jest.fn(),
    cancel: jest.fn(),
  };
  const service = new EWayBillService(
    prisma as any,
    taxConfig as any,
    provider as any,
  );
  return { service, prisma, taxConfig, provider };
}

describe('EWayBillService.classifyForSubOrder', () => {
  it('creates NOT_REQUIRED row when consignment is below threshold', async () => {
    const { service, prisma } = makeService({ threshold: 50_00_00 });
    prisma.eWayBill.findFirst.mockResolvedValue(null);
    // No invoice yet — fall back to order item sum.
    prisma.orderItem.findMany.mockResolvedValue([
      { totalPriceInPaise: 30_00_00n },
    ]);
    prisma.eWayBill.create.mockImplementation(async (args: any) => ({
      id: 'ewb-1',
      ...args.data,
    }));

    const result = await service.classifyForSubOrder('sub-1');
    expect(result.required).toBe(false);
    expect(result.row.status).toBe('NOT_REQUIRED');
    expect(result.consignmentValueInPaise).toBe(30_00_00n);
  });

  it('creates REQUIRED row when consignment exceeds threshold', async () => {
    const { service, prisma } = makeService({ threshold: 50_00_00 });
    prisma.eWayBill.findFirst.mockResolvedValue(null);
    prisma.orderItem.findMany.mockResolvedValue([
      { totalPriceInPaise: 75_00_00n },
    ]);
    prisma.eWayBill.create.mockImplementation(async (args: any) => ({
      id: 'ewb-2',
      ...args.data,
    }));

    const result = await service.classifyForSubOrder('sub-2');
    expect(result.required).toBe(true);
    expect(result.row.status).toBe('REQUIRED');
  });

  it('returns the existing row on re-call (idempotent)', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findFirst.mockResolvedValue({
      id: 'ewb-existing',
      status: 'GENERATED',
      consignmentValueInPaise: 75_00_00n,
    });
    const result = await service.classifyForSubOrder('sub-3');
    expect(prisma.eWayBill.create).not.toHaveBeenCalled();
    expect(result.row.id).toBe('ewb-existing');
    expect(result.required).toBe(true);
  });

  it('flips NOT_REQUIRED → REQUIRED when invoice total later crosses threshold', async () => {
    const { service, prisma } = makeService({ threshold: 50_00_00 });
    prisma.eWayBill.findFirst.mockResolvedValue({
      id: 'ewb-flip',
      status: 'NOT_REQUIRED',
      consignmentValueInPaise: 30_00_00n,
    });
    // The order's invoice now exists with higher total.
    prisma.taxDocument.findFirst.mockResolvedValueOnce({
      id: 'doc-1',
      documentNumber: 'SM-INV-000005',
      documentTotalInPaise: 60_00_00n,
      supplierGstin: '29ABCDE1234F1Z5',
      generatedAt: new Date(),
    });
    prisma.eWayBill.update.mockImplementation(async (args: any) => ({
      id: 'ewb-flip',
      status: 'REQUIRED',
      consignmentValueInPaise: 60_00_00n,
      ...args.data,
    }));

    const result = await service.classifyForSubOrder('sub-flip');
    expect(prisma.eWayBill.update).toHaveBeenCalled();
    expect(result.row.status).toBe('REQUIRED');
    expect(result.required).toBe(true);
  });

  it('uses invoice document total when invoice exists', async () => {
    const { service, prisma } = makeService({ threshold: 50_00_00 });
    prisma.eWayBill.findFirst.mockResolvedValue(null);
    prisma.taxDocument.findFirst.mockResolvedValueOnce({
      id: 'doc-x',
      documentNumber: 'SM-INV-000010',
      documentTotalInPaise: 80_00_00n,
      supplierGstin: '29ABCDE1234F1Z5',
      generatedAt: new Date(),
    });
    prisma.eWayBill.create.mockImplementation(async (args: any) => ({
      id: 'ewb-x',
      ...args.data,
    }));

    const result = await service.classifyForSubOrder('sub-x');
    expect(result.consignmentValueInPaise).toBe(80_00_00n);
    expect(prisma.eWayBill.create.mock.calls[0][0].data.taxDocumentId).toBe('doc-x');
    expect(prisma.eWayBill.create.mock.calls[0][0].data.supplierGstin).toBe('29ABCDE1234F1Z5');
  });
});

describe('EWayBillService.generate', () => {
  it('refuses on sub-orders below threshold', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findFirst.mockResolvedValue({
      id: 'ewb-nr',
      status: 'NOT_REQUIRED',
      consignmentValueInPaise: 1_00_00n,
    });
    await expect(service.generate('sub-nr')).rejects.toThrow(
      /below the EWB threshold/,
    );
  });

  it('returns existing row when already GENERATED (idempotent)', async () => {
    const { service, prisma, provider } = makeService();
    prisma.eWayBill.findFirst.mockResolvedValue({
      id: 'ewb-g',
      status: 'GENERATED',
      ewbNumber: 'EWB-STUB-abc',
      consignmentValueInPaise: 75_00_00n,
    });
    const result = await service.generate('sub-g');
    expect(provider.generate).not.toHaveBeenCalled();
    expect(result.id).toBe('ewb-g');
    expect(result.ewbNumber).toBe('EWB-STUB-abc');
  });

  it('refuses on CANCELLED rows', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findFirst.mockResolvedValue({
      id: 'ewb-c',
      status: 'CANCELLED',
      consignmentValueInPaise: 75_00_00n,
    });
    await expect(service.generate('sub-c')).rejects.toThrow(
      /cannot be generated from status CANCELLED/,
    );
  });

  it('calls provider and persists EWB number on success', async () => {
    const { service, prisma, provider } = makeService();
    prisma.eWayBill.findFirst.mockResolvedValue({
      id: 'ewb-ok',
      status: 'REQUIRED',
      consignmentValueInPaise: 75_00_00n,
      transportMode: 'ROAD',
      vehicleNumber: null,
      transporterId: null,
      transporterName: null,
      distanceKm: null,
      fromPincode: null,
      fromStateCode: null,
      toPincode: null,
      toStateCode: null,
      taxDocumentId: null,
      supplierGstin: '29ABCDE1234F1Z5',
    });
    prisma.eWayBill.update
      .mockImplementationOnce(async (args: any) => ({
        // Move-to-PENDING update.
        id: 'ewb-ok',
        status: 'PENDING',
        consignmentValueInPaise: 75_00_00n,
        transportMode: 'ROAD',
        vehicleNumber: 'KA01AB1234',
        transporterId: null,
        transporterName: null,
        distanceKm: 350,
        fromPincode: null,
        fromStateCode: null,
        toPincode: null,
        toStateCode: null,
        taxDocumentId: null,
        supplierGstin: '29ABCDE1234F1Z5',
        ...args.data,
      }))
      .mockImplementationOnce(async (args: any) => ({
        // GENERATED update.
        id: 'ewb-ok',
        ...args.data,
      }));
    provider.generate.mockResolvedValue({
      ewbNumber: 'EWB-STUB-deadbeef',
      ewbDate: new Date('2026-05-13T10:00:00Z'),
      validUntil: new Date('2026-05-15T18:29:59.999Z'),
      rawRequestJson: { foo: 'bar' },
      rawResponseJson: { ewbNumber: 'EWB-STUB-deadbeef' },
    });

    const result = await service.generate('sub-ok', {
      vehicleNumber: 'KA01AB1234',
      distanceKm: 350,
    });
    expect(provider.generate).toHaveBeenCalled();
    expect(result.status).toBe('GENERATED');
    expect(result.ewbNumber).toBe('EWB-STUB-deadbeef');
    expect(result.failureReason).toBeNull();
  });

  it('marks FAILED + increments retryCount on provider error', async () => {
    const { service, prisma, provider } = makeService();
    prisma.eWayBill.findFirst.mockResolvedValue({
      id: 'ewb-f',
      status: 'REQUIRED',
      consignmentValueInPaise: 75_00_00n,
      transportMode: 'ROAD',
      vehicleNumber: null,
      transporterId: null,
      transporterName: null,
      distanceKm: null,
      fromPincode: null,
      fromStateCode: null,
      toPincode: null,
      toStateCode: null,
      taxDocumentId: null,
      supplierGstin: '29ABCDE1234F1Z5',
      retryCount: 0,
    });
    prisma.eWayBill.update
      .mockImplementationOnce(async () => ({
        id: 'ewb-f',
        status: 'PENDING',
        consignmentValueInPaise: 75_00_00n,
        transportMode: 'ROAD',
        vehicleNumber: null,
        transporterId: null,
        transporterName: null,
        distanceKm: null,
        fromPincode: null,
        fromStateCode: null,
        toPincode: null,
        toStateCode: null,
        taxDocumentId: null,
        supplierGstin: '29ABCDE1234F1Z5',
      }))
      .mockImplementationOnce(async () => ({
        id: 'ewb-f',
        status: 'FAILED',
        retryCount: 1,
        failureReason: 'NIC timeout',
      }));
    provider.generate.mockRejectedValue(new Error('NIC timeout'));

    await expect(service.generate('sub-f')).rejects.toThrow(/NIC timeout/);
    expect(prisma.eWayBill.update).toHaveBeenCalledTimes(2);
    const failArgs = prisma.eWayBill.update.mock.calls[1][0];
    expect(failArgs.data.status).toBe('FAILED');
    expect(failArgs.data.failureReason).toBe('NIC timeout');
    expect(failArgs.data.retryCount).toEqual({ increment: 1 });
  });
});

describe('EWayBillService.cancel', () => {
  it('throws on unknown id', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findUnique.mockResolvedValue(null);
    await expect(
      service.cancel({ ewbId: 'nope', cancelledBy: 'admin-1', reason: 'r' }),
    ).rejects.toThrow(/not found/);
  });

  it('is idempotent on already CANCELLED', async () => {
    const { service, prisma, provider } = makeService();
    prisma.eWayBill.findUnique.mockResolvedValue({
      id: 'ewb-already',
      status: 'CANCELLED',
    });
    const result = await service.cancel({
      ewbId: 'ewb-already',
      cancelledBy: 'admin-1',
      reason: 'r',
    });
    expect(provider.cancel).not.toHaveBeenCalled();
    expect(result.status).toBe('CANCELLED');
  });

  it('refuses to cancel non-GENERATED rows', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findUnique.mockResolvedValue({
      id: 'ewb-r',
      status: 'REQUIRED',
    });
    await expect(
      service.cancel({ ewbId: 'ewb-r', cancelledBy: 'admin-1', reason: 'r' }),
    ).rejects.toThrow(/cannot be cancelled from status REQUIRED/);
  });

  it('refuses cancellation past the 24h CBIC window', async () => {
    const { service, prisma } = makeService();
    const ewbDate = new Date('2026-05-10T10:00:00Z'); // 3 days ago
    prisma.eWayBill.findUnique.mockResolvedValue({
      id: 'ewb-old',
      status: 'GENERATED',
      ewbNumber: 'EWB-STUB-xyz',
      ewbDate,
    });
    await expect(
      service.cancel({
        ewbId: 'ewb-old',
        cancelledBy: 'admin-1',
        reason: 'r',
        now: new Date('2026-05-13T10:00:00Z'),
      }),
    ).rejects.toThrow(/past the 24-hour cancellation window/);
  });

  it('cancels within window + calls provider', async () => {
    const { service, prisma, provider } = makeService();
    const ewbDate = new Date('2026-05-13T08:00:00Z');
    prisma.eWayBill.findUnique.mockResolvedValue({
      id: 'ewb-cw',
      status: 'GENERATED',
      ewbNumber: 'EWB-STUB-cw',
      ewbDate,
    });
    provider.cancel.mockResolvedValue({
      cancelledAt: new Date('2026-05-13T10:00:00Z'),
      rawResponseJson: {},
    });
    prisma.eWayBill.update.mockImplementation(async (args: any) => ({
      id: 'ewb-cw',
      status: 'CANCELLED',
      ...args.data,
    }));

    const result = await service.cancel({
      ewbId: 'ewb-cw',
      cancelledBy: 'admin-1',
      reason: 'wrong vehicle',
      now: new Date('2026-05-13T10:00:00Z'),
    });
    expect(provider.cancel).toHaveBeenCalledWith({
      ewbNumber: 'EWB-STUB-cw',
      reason: 'wrong vehicle',
    });
    expect(result.status).toBe('CANCELLED');
    expect(result.cancelledBy).toBe('admin-1');
    expect(result.cancellationReason).toBe('wrong vehicle');
  });
});

describe('EWayBillService.canShip', () => {
  it('denies when no EWB row exists for the sub-order', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findFirst.mockResolvedValue(null);
    const r = await service.canShip('sub-noewb');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/classification has not run/);
  });

  it('allows NOT_REQUIRED', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findFirst.mockResolvedValue({
      status: 'NOT_REQUIRED',
    });
    const r = await service.canShip('sub-nr');
    expect(r.allowed).toBe(true);
  });

  it('allows GENERATED', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findFirst.mockResolvedValue({
      status: 'GENERATED',
    });
    const r = await service.canShip('sub-g');
    expect(r.allowed).toBe(true);
  });

  it('blocks REQUIRED without override', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findFirst.mockResolvedValue({
      status: 'REQUIRED',
      overrideAdminId: null,
    });
    const r = await service.canShip('sub-req');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/generation required/);
  });

  it('allows REQUIRED with admin override', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findFirst.mockResolvedValue({
      status: 'REQUIRED',
      overrideAdminId: 'admin-1',
      overrideReason: 'manual EWB email-sent',
    });
    const r = await service.canShip('sub-ovr');
    expect(r.allowed).toBe(true);
    expect(r.reason).toMatch(/admin override by admin-1/);
  });

  it('blocks FAILED without override', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findFirst.mockResolvedValue({
      status: 'FAILED',
      overrideAdminId: null,
    });
    const r = await service.canShip('sub-fail');
    expect(r.allowed).toBe(false);
  });
});

describe('EWayBillService.adminOverride', () => {
  it('throws on unknown id', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findUnique.mockResolvedValue(null);
    await expect(
      service.adminOverride({
        ewbId: 'nope',
        adminId: 'admin-1',
        reason: 'r',
      }),
    ).rejects.toThrow(/not found/);
  });

  it('no-ops on NOT_REQUIRED', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findUnique.mockResolvedValue({
      id: 'ewb-nr',
      status: 'NOT_REQUIRED',
    });
    const result = await service.adminOverride({
      ewbId: 'ewb-nr',
      adminId: 'admin-1',
      reason: 'r',
    });
    expect(prisma.eWayBill.update).not.toHaveBeenCalled();
    expect(result.id).toBe('ewb-nr');
  });

  it('stamps override fields on REQUIRED row', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findUnique.mockResolvedValue({
      id: 'ewb-req',
      status: 'REQUIRED',
    });
    prisma.eWayBill.update.mockImplementation(async (args: any) => ({
      id: 'ewb-req',
      status: 'REQUIRED',
      ...args.data,
    }));

    const result = await service.adminOverride({
      ewbId: 'ewb-req',
      adminId: 'admin-1',
      reason: 'manual EWB issued offline',
    });
    expect(result.overrideAdminId).toBe('admin-1');
    expect(result.overrideReason).toBe('manual EWB issued offline');
    expect(result.overrideAt).toBeInstanceOf(Date);
  });
});
