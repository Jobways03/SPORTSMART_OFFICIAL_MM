// Phase 89 (2026-05-23) — EWayBillService hardening coverage.
//
// Gaps covered (asserted via behaviour):
//   #4   canShip returns allowed=true on OVERRIDDEN, false after revoke
//   #5   inter-state HSN-at-any-value path flips REQUIRED
//   #7   revokeOverride flips OVERRIDDEN → REQUIRED + writes audit
//   #8   adminOverride sets status=OVERRIDDEN
//   #9   high-value override blocked when actor == prior classifier
//   #14  reverse re-classification (REQUIRED → NOT_REQUIRED) when
//        addresses resolve and value drops
//   #18  per-state intra-state threshold honoured
//   #24  thresholdAppliedInPaise + policyVersion persisted

import {
  EWayBillService,
  EWayBillNotEligibleError,
} from './eway-bill.service';
import { EWAY_BILL_EVENTS } from '../../domain/eway-bill-events';

type Tx = any;

function buildPrisma(opts: any = {}) {
  const subOrder = {
    id: opts.subOrderId ?? 'sub-1',
    sellerId: 'seller-1',
    franchiseId: null,
    fulfillmentNodeType: 'SELLER',
    fulfillmentStatus: 'PACKED',
    masterOrder: { shippingAddressSnapshot: opts.shippingAddress ?? null },
  };
  const sellerWarehouse = {
    findFirst: jest.fn().mockResolvedValue(
      opts.sellerWarehousePincode
        ? { pincode: opts.sellerWarehousePincode }
        : null,
    ),
  };
  const franchisePartner = { findUnique: jest.fn().mockResolvedValue(null) };
  const eWayBillAuditLog = {
    create: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue(opts.priorAuditByActor ?? null),
  };
  let storedRow: any = opts.existingRow ?? null;
  const eWayBill = {
    findFirst: jest.fn().mockImplementation(async () => storedRow),
    findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
      if (storedRow && storedRow.id === where.id) return storedRow;
      return opts.existingRow ?? null;
    }),
    create: jest.fn().mockImplementation(async ({ data }: any) => {
      storedRow = { id: 'ewb-1', ...data };
      return storedRow;
    }),
    update: jest.fn().mockImplementation(async ({ where, data }: any) => {
      storedRow = { ...storedRow, ...data, id: where.id ?? storedRow?.id };
      return storedRow;
    }),
  };
  const taxDocument = {
    findFirst: jest.fn().mockResolvedValue(opts.invoice ?? null),
    findUnique: jest.fn().mockResolvedValue(opts.invoiceFull ?? null),
  };
  const orderItem = {
    findMany: jest
      .fn()
      .mockResolvedValue(opts.orderItems ?? [{ totalPriceInPaise: 0n, hsnCode: null }]),
  };
  const prisma: any = {
    subOrder: { findUnique: jest.fn().mockResolvedValue(subOrder) },
    sellerWarehouse,
    franchisePartner,
    eWayBill,
    eWayBillAuditLog,
    taxDocument,
    orderItem,
    postOffice: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockImplementation(async (fn: any) => {
      const tx: Tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        eWayBill,
      };
      return fn(tx);
    }),
  };
  return { prisma, eWayBill, eWayBillAuditLog };
}

function buildTaxConfig(overrides: Record<string, any> = {}) {
  return {
    getNumber: jest.fn().mockImplementation(async (key: string, fallback: number) => {
      if (key in overrides) return overrides[key];
      return fallback;
    }),
    getString: jest.fn().mockImplementation(async (key: string, fallback: string) => {
      if (key in overrides) return overrides[key];
      return fallback;
    }),
    getBoolean: jest.fn(),
    get: jest.fn(),
  };
}

function buildProvider(name = 'stub') {
  return {
    name,
    generate: jest.fn(),
    cancel: jest.fn(),
  };
}

function buildEventBus() {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

describe('EWayBillService (Phase 89)', () => {
  describe('Gap #18 — per-state intra-state threshold', () => {
    it('uses Maharashtra ₹1L threshold when from=to=27', async () => {
      // 40xxxx pincode → state code 27 (Maharashtra).
      const { prisma } = buildPrisma({
        shippingAddress: { pincode: '400001' },
        sellerWarehousePincode: '400010',
      });
      const cfg = buildTaxConfig({
        eway_bill_threshold_paise: 50_00_00,
        eway_bill_threshold_paise_by_state: JSON.stringify({
          '27': 1_00_00_00, // ₹1L
        }),
      });
      const svc = new EWayBillService(prisma as any, cfg as any, buildProvider() as any);
      // ₹75k value — over ₹50k national but under ₹1L Maharashtra.
      prisma.orderItem.findMany.mockResolvedValueOnce([
        { totalPriceInPaise: 75_00_00n, hsnCode: null },
      ]);
      const res = await svc.classifyForSubOrder('sub-1');
      expect(res.required).toBe(false);
      expect(res.row.status).toBe('NOT_REQUIRED');
    });
  });

  describe('Gap #5 — HSN at any value inter-state', () => {
    it('inter-state ₹10k with handicraft HSN 9701 → REQUIRED', async () => {
      const { prisma } = buildPrisma({
        shippingAddress: { pincode: '110001' }, // Delhi 07
        sellerWarehousePincode: '560001', // Karnataka 29
      });
      const cfg = buildTaxConfig();
      const svc = new EWayBillService(prisma as any, cfg as any, buildProvider() as any);
      prisma.orderItem.findMany.mockResolvedValue([
        { totalPriceInPaise: 10_00_00n, hsnCode: '9701' }, // ₹10k, art
      ]);
      const res = await svc.classifyForSubOrder('sub-1');
      expect(res.required).toBe(true);
      expect(res.row.status).toBe('REQUIRED');
    });

    it('inter-state ₹10k with mundane HSN → NOT_REQUIRED', async () => {
      const { prisma } = buildPrisma({
        shippingAddress: { pincode: '110001' },
        sellerWarehousePincode: '560001',
      });
      const cfg = buildTaxConfig();
      const svc = new EWayBillService(prisma as any, cfg as any, buildProvider() as any);
      prisma.orderItem.findMany.mockResolvedValue([
        { totalPriceInPaise: 10_00_00n, hsnCode: '6204' },
      ]);
      const res = await svc.classifyForSubOrder('sub-1');
      expect(res.required).toBe(false);
    });
  });

  describe('Gap #24 — threshold + policy snapshot', () => {
    it('persists thresholdAppliedInPaise + policyVersion on create', async () => {
      const { prisma, eWayBill } = buildPrisma({
        shippingAddress: { pincode: '400001' },
        sellerWarehousePincode: '400010',
      });
      const cfg = buildTaxConfig();
      const svc = new EWayBillService(prisma as any, cfg as any, buildProvider() as any);
      prisma.orderItem.findMany.mockResolvedValue([
        { totalPriceInPaise: 75_00_00n, hsnCode: null },
      ]);
      await svc.classifyForSubOrder('sub-1');
      const created = eWayBill.create.mock.calls[0][0].data;
      expect(created.thresholdAppliedInPaise).toBe(BigInt(50_00_00));
      expect(created.policyVersion).toBe('cbic-2024-q3');
    });
  });

  describe('Gap #14 — reverse re-classification', () => {
    it('downgrades REQUIRED to NOT_REQUIRED when value drops', async () => {
      const existing = {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'REQUIRED',
        consignmentValueInPaise: 75_00_00n,
        overrideAdminId: null,
      };
      const { prisma, eWayBill } = buildPrisma({ existingRow: existing });
      const cfg = buildTaxConfig();
      const svc = new EWayBillService(prisma as any, cfg as any, buildProvider() as any);
      // New value drops below threshold.
      prisma.orderItem.findMany.mockResolvedValue([
        { totalPriceInPaise: 30_00_00n, hsnCode: null },
      ]);
      const res = await svc.classifyForSubOrder('sub-1');
      expect(res.required).toBe(false);
      expect(eWayBill.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'NOT_REQUIRED' }),
        }),
      );
    });

    it('does NOT downgrade when an override is active', async () => {
      const existing = {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'REQUIRED',
        consignmentValueInPaise: 75_00_00n,
        overrideAdminId: 'admin-1',
      };
      const { prisma, eWayBill } = buildPrisma({ existingRow: existing });
      const cfg = buildTaxConfig();
      const svc = new EWayBillService(prisma as any, cfg as any, buildProvider() as any);
      prisma.orderItem.findMany.mockResolvedValue([
        { totalPriceInPaise: 30_00_00n, hsnCode: null },
      ]);
      const res = await svc.classifyForSubOrder('sub-1');
      expect(res.required).toBe(true); // unchanged
      expect(eWayBill.update).not.toHaveBeenCalled();
    });
  });

  describe('Gap #8 — adminOverride sets status=OVERRIDDEN', () => {
    it('flips REQUIRED to OVERRIDDEN + writes audit + emits event', async () => {
      const existing = {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'REQUIRED',
        consignmentValueInPaise: 75_00_00n,
        overrideAdminId: null,
      };
      const { prisma, eWayBill, eWayBillAuditLog } = buildPrisma({ existingRow: existing });
      const cfg = buildTaxConfig();
      const eventBus = buildEventBus();
      const svc = new EWayBillService(
        prisma as any,
        cfg as any,
        buildProvider() as any,
        eventBus as any,
      );
      await svc.adminOverride({
        ewbId: 'ewb-1',
        adminId: 'admin-1',
        reason: 'NIC outage — urgent dispatch authorised',
        reasonCategory: 'NIC_OUTAGE',
      });
      const updateData = eWayBill.update.mock.calls[0][0].data;
      expect(updateData.status).toBe('OVERRIDDEN');
      expect(updateData.overrideReasonCategory).toBe('NIC_OUTAGE');
      expect(eWayBillAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'OVERRIDE' }),
        }),
      );
      const names = eventBus.publish.mock.calls.map((c: any[]) => c[0].eventName);
      expect(names).toContain(EWAY_BILL_EVENTS.OVERRIDDEN);
    });
  });

  describe('Gap #9 — separation of duty on high-value override', () => {
    it('blocks override when actor was the prior classifier (value > ₹2L)', async () => {
      const existing = {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'REQUIRED',
        consignmentValueInPaise: 5_00_00_00n, // ₹5L
        overrideAdminId: null,
      };
      const { prisma } = buildPrisma({
        existingRow: existing,
        // Audit log says admin-1 already classified.
        priorAuditByActor: { id: 'audit-1' },
      });
      const cfg = buildTaxConfig();
      const svc = new EWayBillService(prisma as any, cfg as any, buildProvider() as any);
      await expect(
        svc.adminOverride({
          ewbId: 'ewb-1',
          adminId: 'admin-1',
          reason: 'Need to ship now — urgent shipment',
          reasonCategory: 'URGENT_DISPATCH',
        }),
      ).rejects.toThrow(/separation of duty/i);
    });

    it('allows override when actor differs', async () => {
      const existing = {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'REQUIRED',
        consignmentValueInPaise: 5_00_00_00n,
        overrideAdminId: null,
      };
      const { prisma } = buildPrisma({
        existingRow: existing,
        // No prior audit by admin-2.
        priorAuditByActor: null,
      });
      const cfg = buildTaxConfig();
      const svc = new EWayBillService(prisma as any, cfg as any, buildProvider() as any);
      const res = await svc.adminOverride({
        ewbId: 'ewb-1',
        adminId: 'admin-2',
        reason: 'GST exempt cargo — confirmed by finance',
        reasonCategory: 'GST_EXEMPT',
      });
      expect(res.status).toBe('OVERRIDDEN');
    });
  });

  describe('Gap #7 — revokeOverride', () => {
    it('flips OVERRIDDEN → REQUIRED + sets revoke fields', async () => {
      const existing = {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'OVERRIDDEN',
        consignmentValueInPaise: 75_00_00n,
      };
      const { prisma, eWayBill } = buildPrisma({ existingRow: existing });
      const cfg = buildTaxConfig();
      const svc = new EWayBillService(prisma as any, cfg as any, buildProvider() as any);
      await svc.revokeOverride({
        ewbId: 'ewb-1',
        adminId: 'admin-2',
        reason: 'NIC came back online — override no longer needed',
      });
      const updateData = eWayBill.update.mock.calls[0][0].data;
      expect(updateData.status).toBe('REQUIRED');
      expect(updateData.overrideRevokedBy).toBe('admin-2');
      expect(updateData.overrideRevokedAt).toBeInstanceOf(Date);
    });

    it('rejects revoke when status is not OVERRIDDEN', async () => {
      const existing = {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'GENERATED',
      };
      const { prisma } = buildPrisma({ existingRow: existing });
      const cfg = buildTaxConfig();
      const svc = new EWayBillService(prisma as any, cfg as any, buildProvider() as any);
      await expect(
        svc.revokeOverride({
          ewbId: 'ewb-1',
          adminId: 'admin-2',
          reason: 'test',
        }),
      ).rejects.toBeInstanceOf(EWayBillNotEligibleError);
    });
  });

  describe('Gap #4 — canShip with OVERRIDDEN + revoke', () => {
    it('OVERRIDDEN row returns allowed=true', async () => {
      const existing = {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'OVERRIDDEN',
        overrideRevokedAt: null,
      };
      const { prisma } = buildPrisma({ existingRow: existing });
      const cfg = buildTaxConfig();
      const svc = new EWayBillService(prisma as any, cfg as any, buildProvider() as any);
      const decision = await svc.canShip('sub-1');
      expect(decision.allowed).toBe(true);
    });

    it('revoked OVERRIDDEN row returns allowed=false', async () => {
      const existing = {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'OVERRIDDEN',
        overrideRevokedAt: new Date(),
      };
      const { prisma } = buildPrisma({ existingRow: existing });
      const cfg = buildTaxConfig();
      const svc = new EWayBillService(prisma as any, cfg as any, buildProvider() as any);
      const decision = await svc.canShip('sub-1');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toMatch(/revoked/);
    });

    it('REQUIRED with no override returns allowed=false', async () => {
      const existing = {
        id: 'ewb-1',
        subOrderId: 'sub-1',
        status: 'REQUIRED',
      };
      const { prisma } = buildPrisma({ existingRow: existing });
      const cfg = buildTaxConfig();
      const svc = new EWayBillService(prisma as any, cfg as any, buildProvider() as any);
      const decision = await svc.canShip('sub-1');
      expect(decision.allowed).toBe(false);
    });
  });
});
