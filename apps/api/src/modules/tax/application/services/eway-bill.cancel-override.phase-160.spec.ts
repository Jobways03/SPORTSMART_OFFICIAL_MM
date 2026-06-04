// Phase 160 — E-Way Bill CANCEL / OVERRIDE flow audit remediation coverage.
//
// Proves (behaviourally, at runtime — not just "configured") the closure of
// every verified finding from the cancel/override audit:
//
//   B1   two-phase cancel: CANCELLATION_PENDING is written BEFORE the
//        provider call; success settles to CANCELLED; provider failure parks
//        the row in CANCELLATION_FAILED; a stuck PENDING/FAILED row re-drives.
//   B2   override flips status → OVERRIDDEN and records preOverrideStatus.
//   B3   OVERRIDDEN enum value is the status (covered via B2 assertions).
//   B4   override + cancel write append-only audit-log rows.
//   #7   providerCancelReference persisted from the provider result.
//   #8   cancel response lands in rawCancelResponseJson — the generate
//        response in rawResponseJson is never clobbered.
//   #9/  24h window is measured server-side and rejected at the skew-adjusted
//   #10  boundary with `>=` (10-minute safety margin).
//   #12  revokeOverride restores the EXACT pre-override status (not a
//        hardcoded REQUIRED) and clears the override.
//   #13  override of a NOT_REQUIRED row throws (no silent no-op).
//   #14  canShip enforces an optional override TTL.
//   #11  replaceEwayBill cancels + regenerates + links replacedEwayBillId.
//   #18  updateTransportDetails (Part-B) re-issues validity without cancel.
//   B5   canShip blocks a GENERATED-but-past-validUntil EWB synchronously.
//   #17  controller requires the elevated tax.ewayBill.override.superAdmin
//        permission for high-value (>₹2L) overrides.

import 'reflect-metadata';
import {
  EWayBillService,
  EWayBillNotEligibleError,
  EWayBillCancellationWindowClosedError,
} from './eway-bill.service';
import { EWAY_BILL_EVENTS } from '../../domain/eway-bill-events';
import { AdminTaxOperationsController } from '../../presentation/controllers/admin-tax-operations.controller';
import { HttpException } from '@nestjs/common';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MIN = 60 * 1000;

function buildHarness(opts: any = {}) {
  let row: any = opts.row ?? null;
  const eWayBill = {
    findUnique: jest.fn(async ({ where }: any) =>
      row && row.id === where.id ? row : null,
    ),
    findFirst: jest.fn(async () => row),
    update: jest.fn(async ({ where, data }: any) => {
      row = { ...row, ...data, id: where.id ?? row?.id };
      return row;
    }),
    create: jest.fn(async ({ data }: any) => {
      row = { id: 'ewb-new', ...data };
      return row;
    }),
    findUniqueOrThrow: jest.fn(async () => row),
  };
  const eWayBillAuditLog = {
    create: jest.fn(async () => ({})),
    findFirst: jest.fn(async () => opts.priorAudit ?? null),
  };
  const subOrder = {
    findUnique: jest.fn(async () => ({
      fulfillmentStatus: opts.fulfillmentStatus ?? 'PACKED',
      sellerId: 'seller-1',
      franchiseId: null,
      fulfillmentNodeType: 'SELLER',
      masterOrder: { shippingAddressSnapshot: null },
    })),
  };
  const prisma: any = {
    eWayBill,
    eWayBillAuditLog,
    subOrder,
    sellerWarehouse: { findFirst: jest.fn(async () => null) },
    franchisePartner: { findUnique: jest.fn(async () => null) },
    taxDocument: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => null),
    },
    orderItem: {
      findMany: jest.fn(async () => [{ totalPriceInPaise: 0n, hsnCode: null }]),
    },
    postOffice: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (fn: any) =>
      fn({ $queryRaw: jest.fn(async () => []), eWayBill }),
    ),
  };
  return { prisma, eWayBill, eWayBillAuditLog, subOrder };
}

function buildTaxConfig(overrides: Record<string, any> = {}) {
  return {
    getNumber: jest.fn(async (key: string, fallback: number) =>
      key in overrides ? overrides[key] : fallback,
    ),
    getString: jest.fn(async (key: string, fallback: string) =>
      key in overrides ? overrides[key] : fallback,
    ),
    getBoolean: jest.fn(async (_k: string, fallback: boolean) => fallback),
    get: jest.fn(),
  };
}

function buildProvider(name = 'stub', impl: any = {}) {
  return {
    name,
    generate: jest.fn(
      impl.generate ??
        (async () => ({
          ewbNumber: 'EWB-X',
          ewbDate: new Date(),
          validUntil: new Date(Date.now() + DAY),
          rawRequestJson: {},
          rawResponseJson: { gen: true },
        })),
    ),
    cancel: jest.fn(
      impl.cancel ??
        (async () => ({
          cancelledAt: new Date(),
          providerCancelReference: 'CXL-REF-1',
          rawResponseJson: { cxl: true },
        })),
    ),
    updatePartB: jest.fn(
      impl.updatePartB ??
        (async () => ({
          validUntil: new Date(Date.now() + 2 * DAY),
          rawResponseJson: { partb: true },
        })),
    ),
  };
}

function buildEventBus() {
  return { publish: jest.fn(async () => undefined) };
}

describe('EWayBillService — cancel flow (Phase 160)', () => {
  const NOW = new Date('2026-05-29T12:00:00.000Z');

  it('B1: writes CANCELLATION_PENDING BEFORE the provider call, then settles CANCELLED', async () => {
    const row = {
      id: 'ewb-1',
      subOrderId: 'sub-1',
      status: 'GENERATED',
      ewbNumber: 'EWB-123',
      ewbDate: new Date(NOW.getTime() - HOUR), // 1h old → inside window
    };
    const { prisma, eWayBill, eWayBillAuditLog } = buildHarness({ row });
    const provider = buildProvider();
    const svc = new EWayBillService(
      prisma,
      buildTaxConfig() as any,
      provider as any,
      buildEventBus() as any,
    );

    const res = await svc.cancel({
      ewbId: 'ewb-1',
      cancelledBy: 'admin-1',
      reason: 'wrong vehicle number entered',
      now: NOW,
    });

    expect(provider.cancel).toHaveBeenCalledTimes(1);
    expect(provider.cancel.mock.calls[0]![0]).toMatchObject({
      ewbNumber: 'EWB-123',
      reason: 'wrong vehicle number entered',
    });

    const calls = eWayBill.update.mock.calls;
    const orders = eWayBill.update.mock.invocationCallOrder;
    const pendingIdx = calls.findIndex(
      (c: any) => c[0].data.status === 'CANCELLATION_PENDING',
    );
    const cancelledIdx = calls.findIndex(
      (c: any) => c[0].data.status === 'CANCELLED',
    );
    expect(pendingIdx).toBeGreaterThanOrEqual(0);
    expect(cancelledIdx).toBeGreaterThanOrEqual(0);
    // PENDING write happens before the provider call; CANCELLED after.
    expect(orders[pendingIdx]!).toBeLessThan(
      provider.cancel.mock.invocationCallOrder[0]!,
    );
    expect(provider.cancel.mock.invocationCallOrder[0]!).toBeLessThan(
      orders[cancelledIdx]!,
    );

    // PENDING marker carries the two-phase recovery fields.
    expect(calls[pendingIdx]![0].data).toMatchObject({
      cancelInitiatedBy: 'admin-1',
    });
    expect(calls[pendingIdx]![0].data.cancelInitiatedAt).toBeInstanceOf(Date);

    // #7 + #8 — reference persisted; cancel response SEPARATE from generate.
    const cancelledData = calls[cancelledIdx]![0].data;
    expect(cancelledData.providerCancelReference).toBe('CXL-REF-1');
    expect(cancelledData.rawCancelResponseJson).toBeDefined();
    expect(cancelledData).not.toHaveProperty('rawResponseJson');

    // B4 — append-only audit trail (INITIATED then CANCEL).
    const actions = eWayBillAuditLog.create.mock.calls.map(
      (c: any) => c[0].data.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['CANCEL_INITIATED', 'CANCEL']),
    );
    expect(res.status).toBe('CANCELLED');
  });

  it('B1: provider failure parks the row in CANCELLATION_FAILED + rethrows', async () => {
    const row = {
      id: 'ewb-1',
      subOrderId: 'sub-1',
      status: 'GENERATED',
      ewbNumber: 'EWB-123',
      ewbDate: new Date(NOW.getTime() - HOUR),
    };
    const { prisma, eWayBill, eWayBillAuditLog } = buildHarness({ row });
    const provider = buildProvider('stub', {
      cancel: async () => {
        throw new Error('NIC 5xx transient');
      },
    });
    const svc = new EWayBillService(
      prisma,
      buildTaxConfig() as any,
      provider as any,
    );

    await expect(
      svc.cancel({
        ewbId: 'ewb-1',
        cancelledBy: 'admin-1',
        reason: 'wrong vehicle number entered',
        now: NOW,
      }),
    ).rejects.toThrow('NIC 5xx transient');

    const failedCall = eWayBill.update.mock.calls.find(
      (c: any) => c[0].data.status === 'CANCELLATION_FAILED',
    );
    expect(failedCall).toBeTruthy();
    expect(failedCall![0].data.failureReason).toContain('NIC 5xx transient');
    const actions = eWayBillAuditLog.create.mock.calls.map(
      (c: any) => c[0].data.action,
    );
    expect(actions).toContain('CANCEL_FAILED');
  });

  it('B1/#18: re-drives a stuck CANCELLATION_PENDING row without re-checking the window', async () => {
    const row = {
      id: 'ewb-1',
      subOrderId: 'sub-1',
      status: 'CANCELLATION_PENDING',
      ewbNumber: 'EWB-123',
      // Deliberately ancient — proves the window is NOT re-checked on re-drive.
      ewbDate: new Date(NOW.getTime() - 10 * DAY),
      cancellationReason: 'original reason persisted on the pending row',
    };
    const { prisma, eWayBill } = buildHarness({ row });
    const provider = buildProvider();
    const svc = new EWayBillService(
      prisma,
      buildTaxConfig() as any,
      provider as any,
    );

    const res = await svc.cancel({
      ewbId: 'ewb-1',
      cancelledBy: 'system-reconcile',
      reason: 'ignored — pending row carries its own reason',
      now: NOW,
    });

    expect(provider.cancel).toHaveBeenCalledTimes(1);
    // Uses the reason persisted on the pending row, not the call arg.
    expect(provider.cancel.mock.calls[0]![0].reason).toBe(
      'original reason persisted on the pending row',
    );
    expect(res.status).toBe('CANCELLED');
    expect(
      eWayBill.update.mock.calls.some(
        (c: any) => c[0].data.status === 'CANCELLED',
      ),
    ).toBe(true);
  });

  it('#9/#10: rejects at the skew-adjusted 24h boundary (>=) and allows just inside it', async () => {
    const provider = buildProvider();

    // age = 24h − 10m exactly → at the (window − margin) boundary → REJECT.
    const atBoundary = buildHarness({
      row: {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'GENERATED',
        ewbNumber: 'EWB-1',
        ewbDate: new Date(NOW.getTime() - (DAY - 10 * MIN)),
      },
    });
    const svc1 = new EWayBillService(
      atBoundary.prisma,
      buildTaxConfig() as any,
      provider as any,
    );
    await expect(
      svc1.cancel({ ewbId: 'ewb-1', cancelledBy: 'a', reason: 'r'.repeat(10), now: NOW }),
    ).rejects.toBeInstanceOf(EWayBillCancellationWindowClosedError);

    // age = 24h − 11m → inside the window → ALLOWED (provider called).
    const inside = buildHarness({
      row: {
        id: 'ewb-2',
        subOrderId: 'sub-2',
        status: 'GENERATED',
        ewbNumber: 'EWB-2',
        ewbDate: new Date(NOW.getTime() - (DAY - 11 * MIN)),
      },
    });
    const provider2 = buildProvider();
    const svc2 = new EWayBillService(
      inside.prisma,
      buildTaxConfig() as any,
      provider2 as any,
    );
    const res = await svc2.cancel({
      ewbId: 'ewb-2',
      cancelledBy: 'a',
      reason: 'r'.repeat(10),
      now: NOW,
    });
    expect(provider2.cancel).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('CANCELLED');
  });

  it('is idempotent on an already-CANCELLED row (no provider call)', async () => {
    const { prisma, eWayBill } = buildHarness({
      row: { id: 'ewb-1', subOrderId: 'sub-1', status: 'CANCELLED' },
    });
    const provider = buildProvider();
    const svc = new EWayBillService(prisma, buildTaxConfig() as any, provider as any);
    const res = await svc.cancel({ ewbId: 'ewb-1', cancelledBy: 'a', reason: 'r'.repeat(10) });
    expect(res.status).toBe('CANCELLED');
    expect(provider.cancel).not.toHaveBeenCalled();
    expect(eWayBill.update).not.toHaveBeenCalled();
  });

  it('rejects cancelling a non-GENERATED row', async () => {
    const { prisma } = buildHarness({
      row: { id: 'ewb-1', subOrderId: 'sub-1', status: 'REQUIRED' },
    });
    const svc = new EWayBillService(prisma, buildTaxConfig() as any, buildProvider() as any);
    await expect(
      svc.cancel({ ewbId: 'ewb-1', cancelledBy: 'a', reason: 'r'.repeat(10) }),
    ).rejects.toBeInstanceOf(EWayBillNotEligibleError);
  });

  it('blocks cancel once the sub-order is DELIVERED (CBIC post-delivery rule)', async () => {
    const provider = buildProvider();
    const { prisma } = buildHarness({
      row: {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'GENERATED',
        ewbNumber: 'EWB-1',
        ewbDate: new Date(NOW.getTime() - HOUR),
      },
      fulfillmentStatus: 'DELIVERED',
    });
    const svc = new EWayBillService(prisma, buildTaxConfig() as any, provider as any);
    await expect(
      svc.cancel({ ewbId: 'ewb-1', cancelledBy: 'a', reason: 'r'.repeat(10), now: NOW }),
    ).rejects.toBeInstanceOf(EWayBillNotEligibleError);
    expect(provider.cancel).not.toHaveBeenCalled();
  });
});

describe('EWayBillService — override flow (Phase 160)', () => {
  it('B2/B3: flips status → OVERRIDDEN and records preOverrideStatus', async () => {
    const { prisma, eWayBill, eWayBillAuditLog } = buildHarness({
      row: {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'FAILED',
        consignmentValueInPaise: 75_00_00n, // below the ₹2L SoD threshold
      },
    });
    const eventBus = buildEventBus();
    const svc = new EWayBillService(
      prisma,
      buildTaxConfig() as any,
      buildProvider() as any,
      eventBus as any,
    );
    const res = await svc.adminOverride({
      ewbId: 'ewb-1',
      adminId: 'admin-1',
      reason: 'NIC outage, urgent dispatch authorised',
      reasonCategory: 'NIC_OUTAGE',
    });
    expect(res.status).toBe('OVERRIDDEN');
    const data = eWayBill.update.mock.calls[0]![0].data;
    expect(data.preOverrideStatus).toBe('FAILED');
    // B4 — audit row + event.
    const actions = eWayBillAuditLog.create.mock.calls.map((c: any) => c[0].data.action);
    expect(actions).toContain('OVERRIDE');
    const events = eventBus.publish.mock.calls.map((c: any) => c[0].eventName);
    expect(events).toContain(EWAY_BILL_EVENTS.OVERRIDDEN);
  });

  it('B2: re-overriding an OVERRIDDEN row preserves the ORIGINAL preOverrideStatus', async () => {
    const { prisma, eWayBill } = buildHarness({
      row: {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'OVERRIDDEN',
        preOverrideStatus: 'FAILED',
        consignmentValueInPaise: 75_00_00n,
      },
    });
    const svc = new EWayBillService(prisma, buildTaxConfig() as any, buildProvider() as any);
    await svc.adminOverride({
      ewbId: 'ewb-1',
      adminId: 'admin-1',
      reason: 'still down — re-authorising dispatch',
      reasonCategory: 'NIC_OUTAGE',
    });
    expect(eWayBill.update.mock.calls[0]![0].data.preOverrideStatus).toBe('FAILED');
  });

  it('#13: override of a NOT_REQUIRED row throws (no silent no-op)', async () => {
    const { prisma, eWayBill } = buildHarness({
      row: { id: 'ewb-1', subOrderId: 'sub-1', status: 'NOT_REQUIRED', consignmentValueInPaise: 10_00n },
    });
    const svc = new EWayBillService(prisma, buildTaxConfig() as any, buildProvider() as any);
    await expect(
      svc.adminOverride({
        ewbId: 'ewb-1',
        adminId: 'admin-1',
        reason: 'should not be allowed',
        reasonCategory: 'OTHER',
      }),
    ).rejects.toBeInstanceOf(EWayBillNotEligibleError);
    expect(eWayBill.update).not.toHaveBeenCalled();
  });

  it('rejects override of GENERATED / CANCELLED rows', async () => {
    for (const status of ['GENERATED', 'CANCELLED']) {
      const { prisma } = buildHarness({
        row: { id: 'ewb-1', subOrderId: 'sub-1', status, consignmentValueInPaise: 10_00n },
      });
      const svc = new EWayBillService(prisma, buildTaxConfig() as any, buildProvider() as any);
      await expect(
        svc.adminOverride({
          ewbId: 'ewb-1',
          adminId: 'admin-1',
          reason: 'not eligible',
          reasonCategory: 'OTHER',
        }),
      ).rejects.toBeInstanceOf(EWayBillNotEligibleError);
    }
  });

  it('#12: revokeOverride restores the EXACT pre-override status (not hardcoded REQUIRED)', async () => {
    const { prisma, eWayBill } = buildHarness({
      row: {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'OVERRIDDEN',
        preOverrideStatus: 'FAILED',
      },
    });
    const svc = new EWayBillService(prisma, buildTaxConfig() as any, buildProvider() as any);
    await svc.revokeOverride({ ewbId: 'ewb-1', adminId: 'admin-2', reason: 'NIC back online now' });
    const data = eWayBill.update.mock.calls[0]![0].data;
    expect(data.status).toBe('FAILED'); // restored exactly
    expect(data.preOverrideStatus).toBeNull();
    expect(data.overrideRevokedBy).toBe('admin-2');
    expect(data.overrideRevokedAt).toBeInstanceOf(Date);
  });

  it('#12: revokeOverride falls back to REQUIRED when preOverrideStatus is null', async () => {
    const { prisma, eWayBill } = buildHarness({
      row: { id: 'ewb-1', subOrderId: 'sub-1', status: 'OVERRIDDEN', preOverrideStatus: null },
    });
    const svc = new EWayBillService(prisma, buildTaxConfig() as any, buildProvider() as any);
    await svc.revokeOverride({ ewbId: 'ewb-1', adminId: 'admin-2', reason: 'no longer needed' });
    expect(eWayBill.update.mock.calls[0]![0].data.status).toBe('REQUIRED');
  });
});

describe('EWayBillService — canShip guards (Phase 160)', () => {
  it('#14: blocks an OVERRIDDEN row older than the configured TTL, allows within it', async () => {
    const expired = buildHarness({
      row: {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'OVERRIDDEN',
        overrideRevokedAt: null,
        overrideAt: new Date(Date.now() - 25 * HOUR),
      },
    });
    const svc1 = new EWayBillService(
      expired.prisma,
      buildTaxConfig({ eway_bill_override_ttl_hours: 24 }) as any,
      buildProvider() as any,
    );
    const d1 = await svc1.canShip('sub-1');
    expect(d1.allowed).toBe(false);
    expect(d1.reason).toMatch(/expired/i);

    const fresh = buildHarness({
      row: {
        id: 'ewb-2',
        subOrderId: 'sub-2',
        status: 'OVERRIDDEN',
        overrideRevokedAt: null,
        overrideAt: new Date(Date.now() - 1 * HOUR),
      },
    });
    const svc2 = new EWayBillService(
      fresh.prisma,
      buildTaxConfig({ eway_bill_override_ttl_hours: 24 }) as any,
      buildProvider() as any,
    );
    expect((await svc2.canShip('sub-2')).allowed).toBe(true);
  });

  it('#14: TTL of 0 (default) never expires an override', async () => {
    const { prisma } = buildHarness({
      row: {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'OVERRIDDEN',
        overrideRevokedAt: null,
        overrideAt: new Date(Date.now() - 1000 * HOUR),
      },
    });
    const svc = new EWayBillService(prisma, buildTaxConfig() as any, buildProvider() as any);
    expect((await svc.canShip('sub-1')).allowed).toBe(true);
  });

  it('B5: blocks a GENERATED EWB whose validUntil is already past', async () => {
    const past = buildHarness({
      row: {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'GENERATED',
        ewbNumber: 'EWB-1',
        validUntil: new Date(Date.now() - HOUR),
      },
    });
    const svc1 = new EWayBillService(past.prisma, buildTaxConfig() as any, buildProvider() as any);
    const d1 = await svc1.canShip('sub-1');
    expect(d1.allowed).toBe(false);
    expect(d1.reason).toMatch(/expired/i);

    const future = buildHarness({
      row: {
        id: 'ewb-2',
        subOrderId: 'sub-2',
        status: 'GENERATED',
        ewbNumber: 'EWB-2',
        validUntil: new Date(Date.now() + DAY),
      },
    });
    const svc2 = new EWayBillService(future.prisma, buildTaxConfig() as any, buildProvider() as any);
    expect((await svc2.canShip('sub-2')).allowed).toBe(true);
  });
});

describe('EWayBillService — replace + Part-B (Phase 160)', () => {
  it('#11: replaceEwayBill cancels the old, regenerates, and links replacedEwayBillId', async () => {
    const old = { id: 'ewb-old', subOrderId: 'sub-1' };
    let stored: any = { ...old };
    const eWayBill: any = {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === 'ewb-old' ? old : stored,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        stored = { ...stored, ...data, id: where.id };
        return stored;
      }),
      findUniqueOrThrow: jest.fn(async () => ({
        id: 'ewb-new',
        subOrderId: 'sub-1',
        status: 'GENERATED',
        replacedEwayBillId: 'ewb-old',
      })),
    };
    const prisma: any = { eWayBill, eWayBillAuditLog: { create: jest.fn(async () => ({})) } };
    const svc = new EWayBillService(prisma, buildTaxConfig() as any, buildProvider() as any);
    // Isolate the replace-specific logic (link + audit) from the full
    // cancel/generate pipelines, which have their own dedicated coverage.
    const cancelSpy = jest
      .spyOn(svc, 'cancel')
      .mockResolvedValue({} as any);
    const generateSpy = jest
      .spyOn(svc, 'generate')
      .mockResolvedValue({ id: 'ewb-new', subOrderId: 'sub-1', status: 'GENERATED' } as any);

    const res = await svc.replaceEwayBill({
      ewbId: 'ewb-old',
      actorId: 'admin-1',
      cancelReason: 'wrong consignment value on the original',
      transport: { vehicleNumber: 'KA01AB1234' },
    });

    expect(cancelSpy).toHaveBeenCalledWith(
      expect.objectContaining({ ewbId: 'ewb-old', cancelledBy: 'admin-1' }),
    );
    expect(generateSpy).toHaveBeenCalledWith('sub-1', expect.any(Object));
    const linkCall = eWayBill.update.mock.calls.find(
      (c: any) => c[0].data.replacedEwayBillId === 'ewb-old',
    );
    expect(linkCall).toBeTruthy();
    expect(res.replacedEwayBillId).toBe('ewb-old');
  });

  it('#18: updateTransportDetails (Part-B) re-issues validity on a GENERATED row', async () => {
    const { prisma, eWayBill, eWayBillAuditLog } = buildHarness({
      row: {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'GENERATED',
        ewbNumber: 'EWB-1',
        transportMode: 'ROAD',
        vehicleNumber: 'KA01AA0001',
        validUntil: new Date(Date.now() + HOUR),
      },
    });
    const provider = buildProvider();
    const eventBus = buildEventBus();
    const svc = new EWayBillService(prisma, buildTaxConfig() as any, provider as any, eventBus as any);
    await svc.updateTransportDetails({
      ewbId: 'ewb-1',
      actorId: 'admin-1',
      reason: 'vehicle breakdown, trans-shipment',
      transportMode: 'ROAD',
      vehicleNumber: 'KA02BB2222',
    });
    expect(provider.updatePartB).toHaveBeenCalledTimes(1);
    const data = eWayBill.update.mock.calls[0]![0].data;
    expect(data.vehicleNumber).toBe('KA02BB2222');
    expect(data.validUntil).toBeInstanceOf(Date);
    const actions = eWayBillAuditLog.create.mock.calls.map((c: any) => c[0].data.action);
    expect(actions).toContain('UPDATE_PART_B');
    const events = eventBus.publish.mock.calls.map((c: any) => c[0].eventName);
    expect(events).toContain(EWAY_BILL_EVENTS.PART_B_UPDATED);
  });

  it('#18: Part-B update rejects a non-GENERATED row', async () => {
    const { prisma } = buildHarness({
      row: { id: 'ewb-1', subOrderId: 'sub-1', status: 'REQUIRED' },
    });
    const svc = new EWayBillService(prisma, buildTaxConfig() as any, buildProvider() as any);
    await expect(
      svc.updateTransportDetails({ ewbId: 'ewb-1', actorId: 'a', reason: 'change' }),
    ).rejects.toBeInstanceOf(EWayBillNotEligibleError);
  });

  it('#18: Part-B update rejects ROAD mode without a vehicle number', async () => {
    const { prisma } = buildHarness({
      row: {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'GENERATED',
        ewbNumber: 'EWB-1',
        transportMode: 'ROAD',
        vehicleNumber: null,
      },
    });
    const svc = new EWayBillService(prisma, buildTaxConfig() as any, buildProvider() as any);
    await expect(
      svc.updateTransportDetails({
        ewbId: 'ewb-1',
        actorId: 'a',
        reason: 'keep mode ROAD but no vehicle on file',
        transportMode: 'ROAD',
      }),
    ).rejects.toThrow(/vehicleNumber is required/i);
  });
});

describe('AdminTaxOperationsController — high-value override gate (#17)', () => {
  function buildController(opts: any = {}) {
    const prisma: any = {
      eWayBill: { findUnique: jest.fn(async () => opts.target ?? null) },
    };
    const eway: any = {
      adminOverride: jest.fn(async () => ({
        id: 'ewb-1',
        status: 'OVERRIDDEN',
        overrideAdminId: 'admin-1',
        overrideAt: new Date(),
        overrideReasonCategory: 'NIC_OUTAGE',
      })),
    };
    const audit: any = { writeAuditLog: jest.fn(async () => undefined) };
    const c = new AdminTaxOperationsController(
      prisma,
      {} as any,
      eway,
      {} as any,
      {} as any,
      {} as any,
      audit,
      {} as any, // Tds194OExemptionService (Phase 161)
    );
    return { c, prisma, eway, audit };
  }

  const body = { reasonCategory: 'NIC_OUTAGE', reason: 'x'.repeat(15) } as any;

  it('rejects a high-value (>₹2L) override without tax.ewayBill.override.superAdmin (403)', async () => {
    const { c, eway, audit } = buildController({
      target: { consignmentValueInPaise: 5_00_00_00n }, // ₹5L
    });
    const req = { adminId: 'a1', adminRole: 'TAX', user: { permissions: ['tax.ewayBill.override'] } };
    await expect(c.overrideEwayBill(req, 'ewb-1', body)).rejects.toBeInstanceOf(HttpException);
    try {
      await c.overrideEwayBill(req, 'ewb-1', body);
    } catch (e: any) {
      expect(e.getStatus()).toBe(403);
      expect(e.getResponse().code).toBe('SUPER_ADMIN_REQUIRED');
    }
    expect(eway.adminOverride).not.toHaveBeenCalled();
    // Denied high-value attempt is recorded for compliance.
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tax.ewayBill.override.denied_high_value' }),
    );
  });

  it('allows a high-value override WITH tax.ewayBill.override.superAdmin', async () => {
    const { c, eway } = buildController({
      target: { consignmentValueInPaise: 5_00_00_00n },
    });
    const req = {
      adminId: 'a1',
      user: { permissions: ['tax.ewayBill.override', 'tax.ewayBill.override.superAdmin'] },
    };
    const res = await c.overrideEwayBill(req, 'ewb-1', body);
    expect(eway.adminOverride).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
  });

  it('does NOT require the elevated permission for a low-value override', async () => {
    const { c, eway } = buildController({
      target: { consignmentValueInPaise: 10_00_00n }, // ₹10k
    });
    const req = { adminId: 'a1', user: { permissions: ['tax.ewayBill.override'] } };
    const res = await c.overrideEwayBill(req, 'ewb-1', body);
    expect(eway.adminOverride).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
  });

  it('a missing EWB falls through to the service (404 path), not a 403', async () => {
    const { c, eway } = buildController({ target: null });
    const req = { adminId: 'a1', user: { permissions: ['tax.ewayBill.override'] } };
    await c.overrideEwayBill(req, 'ewb-1', body);
    // Gate is skipped; service is consulted (it would throw NOT_FOUND in prod).
    expect(eway.adminOverride).toHaveBeenCalledTimes(1);
  });
});
