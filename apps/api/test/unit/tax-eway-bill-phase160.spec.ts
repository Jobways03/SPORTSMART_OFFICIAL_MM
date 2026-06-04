import 'reflect-metadata';
import {
  EWayBillService,
  EWayBillDisabledError,
} from '../../src/modules/tax/application/services/eway-bill.service';
import {
  EWayBillProviderError,
} from '../../src/modules/tax/infrastructure/eway-bill/eway-bill-provider';

// Phase 160 — E-Way Bill remediation: kill switch (B4), canShip validUntil
// guard (B5), generate address refetch (#16), typed NIC error mapping (#11),
// and Part-B update (#18).

function makeService(opts: { enabled?: boolean } = {}) {
  const eWayBill = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const prisma: any = {
    eWayBill,
    taxDocument: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn() },
    subOrder: { findUnique: jest.fn().mockResolvedValue(null) },
    orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    eWayBillAuditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (cb: any) =>
      cb({ $queryRaw: jest.fn().mockResolvedValue([]), eWayBill }),
    ),
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const taxConfig: any = {
    getNumber: jest.fn().mockResolvedValue(50_00_00),
    getBoolean: jest.fn().mockResolvedValue(opts.enabled ?? true),
    getJson: jest.fn().mockResolvedValue(null),
  };
  const provider: any = {
    name: 'stub',
    generate: jest.fn(),
    cancel: jest.fn(),
    updatePartB: jest.fn(),
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new EWayBillService(prisma as any, taxConfig as any, provider as any, eventBus);
  (service as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { service, prisma, taxConfig, provider, eWayBill };
}

describe('EWayBillService.isEnabled (kill switch B4)', () => {
  it('defaults to enabled', async () => {
    const { service } = makeService();
    expect(await service.isEnabled()).toBe(true);
  });
  it('disabled only on explicit false', async () => {
    const { service } = makeService({ enabled: false });
    expect(await service.isEnabled()).toBe(false);
  });
  it('treats a config read returning undefined as enabled', async () => {
    const { service, taxConfig } = makeService();
    taxConfig.getBoolean.mockResolvedValue(undefined);
    expect(await service.isEnabled()).toBe(true);
  });
});

describe('EWayBillService.generate — kill switch (B4)', () => {
  it('throws EWayBillDisabledError + never calls the provider when disabled', async () => {
    const { service, provider } = makeService({ enabled: false });
    await expect(service.generate('sub-1')).rejects.toBeInstanceOf(EWayBillDisabledError);
    expect(provider.generate).not.toHaveBeenCalled();
  });
});

describe('EWayBillService.canShip — validity guard (B5)', () => {
  const base = {
    id: 'ewb-1',
    subOrderId: 'sub-1',
    ewbNumber: 'EWB-1',
    overrideRevokedAt: null,
  };
  it('allows a GENERATED EWB that is still valid', async () => {
    const { service, eWayBill } = makeService();
    eWayBill.findFirst.mockResolvedValue({
      ...base,
      status: 'GENERATED',
      validUntil: new Date(Date.now() + 60 * 60 * 1000), // +1h
    });
    const r = await service.canShip('sub-1');
    expect(r.allowed).toBe(true);
  });
  it('BLOCKS a GENERATED EWB past its validUntil (before the expiry cron runs)', async () => {
    const { service, eWayBill } = makeService();
    eWayBill.findFirst.mockResolvedValue({
      ...base,
      status: 'GENERATED',
      validUntil: new Date(Date.now() - 60 * 1000), // 1 min ago
    });
    const r = await service.canShip('sub-1');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/expired/i);
  });
  it('allows GENERATED with no validUntil (legacy rows)', async () => {
    const { service, eWayBill } = makeService();
    eWayBill.findFirst.mockResolvedValue({ ...base, status: 'GENERATED', validUntil: null });
    expect((await service.canShip('sub-1')).allowed).toBe(true);
  });
});

describe('EWayBillService.updateTransportDetails — Part-B (#18)', () => {
  const genRow = {
    id: 'ewb-1',
    subOrderId: 'sub-1',
    status: 'GENERATED',
    ewbNumber: 'EWB-9',
    transportMode: 'ROAD',
    vehicleNumber: 'KA01AB1234',
    transporterId: null,
    transporterName: null,
    distanceKm: 40,
  };

  it('updates Part-B on a GENERATED row + refreshes validity + audits', async () => {
    const { service, provider, eWayBill } = makeService();
    eWayBill.findUnique.mockResolvedValue(genRow);
    eWayBill.update.mockImplementation(async (args: any) => ({ ...genRow, ...args.data }));
    const newValid = new Date(Date.now() + 24 * 60 * 60 * 1000);
    provider.updatePartB.mockResolvedValue({ validUntil: newValid, rawResponseJson: {} });

    const r = await service.updateTransportDetails({
      ewbId: 'ewb-1',
      actorId: 'admin-1',
      reason: 'vehicle breakdown — trans-shipped',
      vehicleNumber: 'KA02XY9999',
    });
    expect(provider.updatePartB).toHaveBeenCalledWith(
      expect.objectContaining({ ewbNumber: 'EWB-9', vehicleNumber: 'KA02XY9999' }),
    );
    expect(r.vehicleNumber).toBe('KA02XY9999');
    expect(r.validUntil).toEqual(newValid);
  });

  it('rejects Part-B update on a non-GENERATED row', async () => {
    const { service, eWayBill } = makeService();
    eWayBill.findUnique.mockResolvedValue({ ...genRow, status: 'REQUIRED', ewbNumber: null });
    await expect(
      service.updateTransportDetails({ ewbId: 'ewb-1', actorId: 'a', reason: 'change vehicle' }),
    ).rejects.toThrow();
  });

  it('rejects a too-short reason', async () => {
    const { service, eWayBill } = makeService();
    eWayBill.findUnique.mockResolvedValue(genRow);
    await expect(
      service.updateTransportDetails({ ewbId: 'ewb-1', actorId: 'a', reason: 'x' }),
    ).rejects.toThrow(/reason/i);
  });
});

describe('EWayBillProviderError (typed mapping #11)', () => {
  it('classifies retryable vs permanent correctly', () => {
    expect(new EWayBillProviderError('x', 'AUTH').retryable).toBe(true);
    expect(new EWayBillProviderError('x', 'RATE_LIMIT').retryable).toBe(true);
    expect(new EWayBillProviderError('x', 'TRANSIENT').retryable).toBe(true);
    expect(new EWayBillProviderError('x', 'PERMANENT').retryable).toBe(false);
  });
});

// ── Cancel / override remediation (cancel-flow audit) ──────────────────
const HOUR = 60 * 60 * 1000;
function genEwb(over: any = {}) {
  return {
    id: 'ewb-1',
    subOrderId: 'sub-1',
    status: 'GENERATED',
    ewbNumber: 'EWB-123',
    ewbDate: new Date(Date.now() - 1 * HOUR), // 1h ago — well in window
    validUntil: new Date(Date.now() + 23 * HOUR),
    consignmentValueInPaise: 200000n,
    overrideRevokedAt: null,
    overrideAt: null,
    preOverrideStatus: null,
    cancelInitiatedBy: null,
    cancellationReason: null,
    ...over,
  };
}

describe('EWayBillService.cancel — two-phase (B1) + skew (#9/#10) + json (#7/#8)', () => {
  it('two-phase cancels: PENDING marker → CANCELLED, with cancel ref + separate json', async () => {
    const { service, prisma, provider } = makeService();
    prisma.eWayBill.findUnique.mockResolvedValue(genEwb());
    prisma.subOrder.findUnique.mockResolvedValue({ fulfillmentStatus: 'PACKED' });
    prisma.eWayBill.update.mockImplementation(async (a: any) => ({ ...genEwb(), ...a.data }));
    provider.cancel.mockResolvedValue({
      cancelledAt: new Date(),
      providerCancelReference: 'NIC-CXL-9',
      rawResponseJson: { cancelled: true },
    });
    const r = await service.cancel({ ewbId: 'ewb-1', cancelledBy: 'admin-1', reason: 'wrong vehicle entered' });
    expect(r.status).toBe('CANCELLED');
    const updates = prisma.eWayBill.update.mock.calls.map((c: any) => c[0].data);
    // Phase 1 marker.
    expect(updates[0].status).toBe('CANCELLATION_PENDING');
    expect(updates[0].cancelInitiatedAt).toBeInstanceOf(Date);
    // Phase 2 settle: cancel ref persisted, cancel json SEPARATE (no clobber).
    expect(updates[1].status).toBe('CANCELLED');
    expect(updates[1].providerCancelReference).toBe('NIC-CXL-9');
    expect(updates[1].rawCancelResponseJson).toEqual({ cancelled: true });
    expect(updates[1].rawResponseJson).toBeUndefined(); // generate response untouched
  });

  it('provider failure → CANCELLATION_FAILED + propagates', async () => {
    const { service, prisma, provider } = makeService();
    prisma.eWayBill.findUnique.mockResolvedValue(genEwb());
    prisma.subOrder.findUnique.mockResolvedValue({ fulfillmentStatus: 'PACKED' });
    prisma.eWayBill.update.mockImplementation(async (a: any) => ({ ...genEwb(), ...a.data }));
    provider.cancel.mockRejectedValue(new Error('NIC down'));
    await expect(
      service.cancel({ ewbId: 'ewb-1', cancelledBy: 'admin-1', reason: 'wrong vehicle entered' }),
    ).rejects.toThrow(/NIC down/);
    const statuses = prisma.eWayBill.update.mock.calls.map((c: any) => c[0].data.status);
    expect(statuses).toContain('CANCELLATION_PENDING');
    expect(statuses).toContain('CANCELLATION_FAILED');
  });

  it('re-drives a stuck CANCELLATION_PENDING row to CANCELLED (reconcile path)', async () => {
    const { service, prisma, provider } = makeService();
    prisma.eWayBill.findUnique.mockResolvedValue(
      genEwb({ status: 'CANCELLATION_PENDING', cancellationReason: 'wrong vehicle entered' }),
    );
    prisma.eWayBill.update.mockImplementation(async (a: any) => ({ ...genEwb(), ...a.data }));
    provider.cancel.mockResolvedValue({ cancelledAt: new Date(), providerCancelReference: 'R', rawResponseJson: {} });
    const r = await service.cancel({ ewbId: 'ewb-1', cancelledBy: 'system-reconcile', reason: 'reconcile' });
    expect(r.status).toBe('CANCELLED');
    // No window re-check on re-drive → subOrder not consulted.
    expect(prisma.subOrder.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a cancel inside the 10-min skew margin of the 24h boundary (#9/#10)', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findUnique.mockResolvedValue(
      genEwb({ ewbDate: new Date(Date.now() - (24 * HOUR - 5 * 60 * 1000)) }), // 23h55m ago
    );
    prisma.subOrder.findUnique.mockResolvedValue({ fulfillmentStatus: 'PACKED' });
    await expect(
      service.cancel({ ewbId: 'ewb-1', cancelledBy: 'admin-1', reason: 'too late attempt here' }),
    ).rejects.toThrow(/24-hour|window/i);
  });
});

describe('EWayBillService.adminOverride / revokeOverride — preOverrideStatus (#2) + #13', () => {
  it('throws (not silent no-op) when overriding a NOT_REQUIRED row (#13)', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findUnique.mockResolvedValue(genEwb({ status: 'NOT_REQUIRED' }));
    await expect(
      service.adminOverride({ ewbId: 'ewb-1', adminId: 'a', reason: 'x', reasonCategory: 'OTHER' as any }),
    ).rejects.toThrow();
  });

  it('persists preOverrideStatus on override + restores it on revoke', async () => {
    const { service, prisma } = makeService();
    // Override a FAILED row.
    prisma.eWayBill.findUnique.mockResolvedValue(genEwb({ status: 'FAILED' }));
    prisma.eWayBill.update.mockImplementation(async (a: any) => ({ ...genEwb(), ...a.data }));
    await service.adminOverride({ ewbId: 'ewb-1', adminId: 'a', reason: 'urgent dispatch needed', reasonCategory: 'URGENT_DISPATCH' as any });
    expect(prisma.eWayBill.update.mock.calls[0][0].data.preOverrideStatus).toBe('FAILED');

    // Now revoke an OVERRIDDEN row whose preOverrideStatus was FAILED.
    const { service: s2, prisma: p2 } = makeService();
    p2.eWayBill.findUnique.mockResolvedValue(genEwb({ status: 'OVERRIDDEN', preOverrideStatus: 'FAILED' }));
    p2.eWayBill.update.mockImplementation(async (a: any) => ({ ...genEwb(), ...a.data }));
    await s2.revokeOverride({ ewbId: 'ewb-1', adminId: 'a', reason: 'override no longer valid' });
    expect(p2.eWayBill.update.mock.calls[0][0].data.status).toBe('FAILED'); // restored, not hardcoded REQUIRED
  });
});

describe('EWayBillService.canShip — override TTL (#14)', () => {
  it('blocks an OVERRIDDEN row past the configured TTL', async () => {
    const { service, prisma, taxConfig } = makeService();
    taxConfig.getNumber.mockImplementation(async (k: string, fb: number) =>
      k === 'eway_bill_override_ttl_hours' ? 24 : fb,
    );
    prisma.eWayBill.findFirst.mockResolvedValue(
      genEwb({ status: 'OVERRIDDEN', overrideAt: new Date(Date.now() - 48 * HOUR) }), // 48h old, TTL 24h
    );
    const r = await service.canShip('sub-1');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/override expired/i);
  });

  it('allows a fresh override within TTL', async () => {
    const { service, prisma, taxConfig } = makeService();
    taxConfig.getNumber.mockImplementation(async (k: string, fb: number) =>
      k === 'eway_bill_override_ttl_hours' ? 24 : fb,
    );
    prisma.eWayBill.findFirst.mockResolvedValue(
      genEwb({ status: 'OVERRIDDEN', overrideAt: new Date(Date.now() - 1 * HOUR) }),
    );
    expect((await service.canShip('sub-1')).allowed).toBe(true);
  });

  it('blocks a CANCELLATION_PENDING row (cancel in flight)', async () => {
    const { service, prisma } = makeService();
    prisma.eWayBill.findFirst.mockResolvedValue(genEwb({ status: 'CANCELLATION_PENDING' }));
    expect((await service.canShip('sub-1')).allowed).toBe(false);
  });
});

describe('EWayBillService.replaceEwayBill (#11)', () => {
  it('cancels the old + generates a fresh one + links replacedEwayBillId', async () => {
    const { service, prisma, provider } = makeService();
    const oldRow = genEwb({ id: 'old-1' });
    // findUnique: 1) replace loads old; 2) cancel loads old (GENERATED).
    prisma.eWayBill.findUnique
      .mockResolvedValueOnce(oldRow) // replace()
      .mockResolvedValueOnce(oldRow) // cancel() inside replace
      .mockResolvedValue(oldRow);
    prisma.subOrder.findUnique.mockResolvedValue({ fulfillmentStatus: 'PACKED' });
    provider.cancel.mockResolvedValue({ cancelledAt: new Date(), providerCancelReference: 'R', rawResponseJson: {} });
    // Stub generate by spying on the service method (avoid the full classify path).
    jest.spyOn(service, 'generate').mockResolvedValue({ ...genEwb({ id: 'new-1', status: 'GENERATED' }) } as any);
    prisma.eWayBill.update.mockImplementation(async (a: any) => ({ ...genEwb(), id: 'new-1', ...a.data }));
    prisma.eWayBill.findUniqueOrThrow = jest.fn().mockResolvedValue(genEwb({ id: 'new-1', replacedEwayBillId: 'old-1' }));

    const r = await service.replaceEwayBill({ ewbId: 'old-1', actorId: 'admin-1', cancelReason: 'wrong consignment value' });
    expect(service.generate).toHaveBeenCalledWith('sub-1', expect.anything());
    expect(r.replacedEwayBillId).toBe('old-1');
  });
});
