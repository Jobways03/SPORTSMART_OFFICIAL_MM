// Phase 82 (2026-05-23) — packing & shipping hardening.
//
// Covers the audit gaps closed in OrdersService.updateFulfillmentStatusInternal:
//   Gap #1     — packedAt/By + shippedAt/By stamped on the row
//   Gap #2/#4  — franchise actor takes the same path as seller (parity)
//   Gap #5     — audit_log row written for PACKED + SHIPPED
//   Gap #10    — trackingUrl derived from courier mapping
//   Gap #11    — DTO rejects bad inputs (covered by unit DTO test)
//   Gap #12/#13 — master rollup to PARTIALLY_SHIPPED vs DISPATCHED
//   Gap #15    — single tx wraps sub-order + master + audit + event
//   Gap #18    — FOR UPDATE row lock + inside-tx FSM re-check
//   Gap #20    — env-driven SHIPMENT_EVIDENCE_REQUIRED_PHOTOS
//
// The DTO validation gap (Gap #11) is covered by the unit test on
// the DTO at the bottom of this file.

import { OrdersService } from './orders.service';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../../../../core/exceptions';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  UpdateFulfillmentStatusDto,
  buildTrackingUrl,
} from '../../presentation/dtos/update-fulfillment-status.dto';

interface FakeTx {
  $queryRaw: jest.Mock;
  subOrder: { update: jest.Mock; findMany: jest.Mock };
  masterOrder: { findUnique: jest.Mock; update: jest.Mock };
  fileAttachment?: { count: jest.Mock };
}

function makeService(opts?: {
  subOrder?: any;
  evidenceCount?: number;
  envEvidenceRequired?: number;
  siblings?: any[];
  masterStatus?: string;
  txLockedRow?: any;
  txExec?: (cb: (tx: FakeTx) => Promise<any>) => Promise<any>;
}) {
  const subOrder = opts?.subOrder ?? {
    id: 'sub-1',
    masterOrderId: 'master-1',
    sellerId: 'seller-1',
    fulfillmentStatus: 'PACKED',
    acceptStatus: 'ACCEPTED',
    packedAt: new Date('2026-05-23T08:00:00Z'),
    items: [],
  };

  const masterStatus = opts?.masterStatus ?? 'SELLER_ACCEPTED';
  const siblings = opts?.siblings ?? [
    { id: 'sub-1', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
  ];

  const lockedRow = opts?.txLockedRow ?? {
    id: subOrder.id,
    fulfillment_status: subOrder.fulfillmentStatus,
    accept_status: subOrder.acceptStatus,
  };

  const txMock: FakeTx = {
    $queryRaw: jest.fn().mockResolvedValue([lockedRow]),
    subOrder: {
      update: jest.fn().mockResolvedValue({
        id: subOrder.id,
        fulfillmentStatus: 'SHIPPED',
      }),
      findMany: jest.fn().mockResolvedValue(siblings),
    },
    masterOrder: {
      findUnique: jest.fn().mockResolvedValue({ orderStatus: masterStatus }),
      update: jest.fn().mockResolvedValue({}),
    },
    // Phase 88 (2026-05-23) — the SHIPPED gate count moved inside
    // the tx (was on prisma.fileAttachment.count before). Mock here
    // so existing specs that don't inject ShipmentEvidenceService
    // hit the fallback path successfully.
    fileAttachment: {
      count: jest.fn().mockResolvedValue(opts?.evidenceCount ?? 4),
    },
  } as any;

  const orderRepo: any = {
    findSubOrderForSellerBasic: jest.fn().mockResolvedValue(subOrder),
    updateSubOrder: jest.fn(),
    updateMasterOrder: jest.fn(),
    executeTransaction: opts?.txExec ?? (async (cb: any) => cb(txMock)),
  };

  const prisma: any = {
    fileAttachment: {
      count: jest.fn().mockResolvedValue(opts?.evidenceCount ?? 4),
    },
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const taxFacade: any = {
    generateInvoiceForSubOrder: jest.fn().mockResolvedValue(undefined),
  };
  const auditFacade: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const env: any = {
    getNumber: (k: string, d: number) => {
      if (k === 'SHIPMENT_EVIDENCE_REQUIRED_PHOTOS')
        return opts?.envEvidenceRequired ?? 4;
      return d;
    },
  };

  // Phase 88 (2026-05-23) — typed shipment-evidence stub. Mirrors
  // the legacy `prisma.fileAttachment.count` behaviour so existing
  // assertions about the gate count still pass; new code reads
  // through this surface.
  const shipmentEvidence: any = {
    countPackingForGate: jest
      .fn()
      .mockResolvedValue(opts?.evidenceCount ?? 4),
    freezePackingEvidence: jest.fn().mockResolvedValue({ frozenCount: 0 }),
    archiveForReassignment: jest
      .fn()
      .mockResolvedValue({ archivedCount: 0 }),
  };

  const svc = new OrdersService(
    orderRepo,
    eventBus,
    {} as any,
    {} as any,
    prisma,
    {} as any,
    env,
    taxFacade,
    auditFacade,
    undefined,
    undefined,
    shipmentEvidence,
  );
  return {
    svc,
    orderRepo,
    prisma,
    eventBus,
    taxFacade,
    auditFacade,
    txMock,
  };
}

describe('OrdersService.updateFulfillmentStatusInternal (Phase 82)', () => {
  describe('Gap #1 — packed/shipped audit columns', () => {
    it('stamps packedAt + packedBy on PACKED transition', async () => {
      let updateArgs: any = null;
      const { svc } = makeService({
        subOrder: {
          id: 'sub-1',
          masterOrderId: 'master-1',
          sellerId: 'seller-1',
          fulfillmentStatus: 'UNFULFILLED',
          acceptStatus: 'ACCEPTED',
          items: [],
        },
        txLockedRow: {
          id: 'sub-1',
          fulfillment_status: 'UNFULFILLED',
          accept_status: 'ACCEPTED',
        },
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              { id: 'sub-1', fulfillment_status: 'UNFULFILLED', accept_status: 'ACCEPTED' },
            ]),
            subOrder: {
              update: jest.fn().mockImplementation((args: any) => {
                updateArgs = args.data;
                return Promise.resolve({ id: 'sub-1' });
              }),
              findMany: jest.fn().mockResolvedValue([]),
            },
            masterOrder: {
              findUnique: jest.fn().mockResolvedValue({ orderStatus: 'SELLER_ACCEPTED' }),
              update: jest.fn(),
            },
          };
          return cb(tx);
        },
      });
      await svc.sellerUpdateFulfillmentStatus('sub-1', 'seller-1', 'PACKED');
      expect(updateArgs.fulfillmentStatus).toBe('PACKED');
      expect(updateArgs.packedAt).toBeInstanceOf(Date);
      expect(updateArgs.packedBy).toBe('seller-1');
    });

    it('stamps shippedAt + shippedBy on SHIPPED transition', async () => {
      let updateArgs: any = null;
      const { svc } = makeService({
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              { id: 'sub-1', fulfillment_status: 'PACKED', accept_status: 'ACCEPTED' },
            ]),
            subOrder: {
              update: jest.fn().mockImplementation((args: any) => {
                updateArgs = args.data;
                return Promise.resolve({ id: 'sub-1' });
              }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
              ]),
            },
            masterOrder: {
              findUnique: jest.fn().mockResolvedValue({ orderStatus: 'SELLER_ACCEPTED' }),
              update: jest.fn(),
            },
          };
          return cb(tx);
        },
      });
      await svc.sellerUpdateFulfillmentStatus('sub-1', 'seller-1', 'SHIPPED', {
        trackingNumber: 'AWB12345678',
        courierName: 'DTDC',
      });
      expect(updateArgs.fulfillmentStatus).toBe('SHIPPED');
      expect(updateArgs.shippedAt).toBeInstanceOf(Date);
      expect(updateArgs.shippedBy).toBe('seller-1');
      expect(updateArgs.trackingNumber).toBe('AWB12345678');
      expect(updateArgs.courierName).toBe('DTDC');
      expect(updateArgs.trackingUrl).toContain('dtdc');
    });
  });

  describe('Gap #5 — audit log row written', () => {
    it('PACKED writes audit log with action=SUB_ORDER_PACKED', async () => {
      const { svc, auditFacade } = makeService({
        subOrder: {
          id: 'sub-1',
          masterOrderId: 'master-1',
          sellerId: 'seller-1',
          fulfillmentStatus: 'UNFULFILLED',
          acceptStatus: 'ACCEPTED',
          items: [],
        },
        txLockedRow: {
          id: 'sub-1',
          fulfillment_status: 'UNFULFILLED',
          accept_status: 'ACCEPTED',
        },
      });
      await svc.sellerUpdateFulfillmentStatus('sub-1', 'seller-1', 'PACKED');
      expect(auditFacade.writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'seller-1',
          actorRole: 'SELLER',
          action: 'SUB_ORDER_PACKED',
        }),
      );
    });

    it('SHIPPED writes audit log with action=SUB_ORDER_SHIPPED + tracking metadata', async () => {
      const { svc, auditFacade } = makeService();
      await svc.sellerUpdateFulfillmentStatus('sub-1', 'seller-1', 'SHIPPED', {
        trackingNumber: 'AWB12345678',
        courierName: 'DELHIVERY',
      });
      const call = auditFacade.writeAuditLog.mock.calls[0]![0];
      expect(call.action).toBe('SUB_ORDER_SHIPPED');
      expect(call.newValue.trackingNumber).toBe('AWB12345678');
      expect(call.newValue.courierName).toBe('DELHIVERY');
      expect(call.newValue.trackingUrl).toContain('delhivery');
    });
  });

  describe('Gap #10 — trackingUrl derived from courier mapping', () => {
    it('DTDC tracking URL built from awb', () => {
      const url = buildTrackingUrl('DTDC', 'AWB12345');
      expect(url).toContain('dtdc');
      expect(url).toContain('AWB12345');
    });

    it('OTHER courier returns null (caller falls back to raw AWB)', () => {
      const url = buildTrackingUrl('OTHER', 'AWB12345');
      expect(url).toBeNull();
    });

    it('null/empty inputs return null', () => {
      expect(buildTrackingUrl(null, 'AWB1')).toBeNull();
      expect(buildTrackingUrl('DTDC', null)).toBeNull();
      expect(buildTrackingUrl('DTDC', '')).toBeNull();
    });
  });

  describe('Gap #12/#13 — master rollup', () => {
    it('flips master to DISPATCHED when ALL active sub-orders shipped', async () => {
      const masterUpdate = jest.fn().mockResolvedValue({});
      const { svc } = makeService({
        siblings: [
          { id: 'sub-1', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
          { id: 'sub-2', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
        ],
        masterStatus: 'SELLER_ACCEPTED',
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              { id: 'sub-1', fulfillment_status: 'PACKED', accept_status: 'ACCEPTED' },
            ]),
            subOrder: {
              update: jest.fn().mockResolvedValue({ id: 'sub-1' }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
                { id: 'sub-2', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
              ]),
            },
            masterOrder: {
              findUnique: jest.fn().mockResolvedValue({ orderStatus: 'SELLER_ACCEPTED' }),
              update: masterUpdate,
            },
          };
          return cb(tx);
        },
      });
      await svc.sellerUpdateFulfillmentStatus('sub-1', 'seller-1', 'SHIPPED', {
        trackingNumber: 'AWB12345678',
        courierName: 'DTDC',
      });
      expect(masterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { orderStatus: 'DISPATCHED' },
        }),
      );
    });

    it('flips master to PARTIALLY_SHIPPED when some sub-orders still pending', async () => {
      const masterUpdate = jest.fn().mockResolvedValue({});
      const { svc } = makeService({
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              { id: 'sub-1', fulfillment_status: 'PACKED', accept_status: 'ACCEPTED' },
            ]),
            subOrder: {
              update: jest.fn().mockResolvedValue({ id: 'sub-1' }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
                { id: 'sub-2', fulfillmentStatus: 'PACKED', acceptStatus: 'ACCEPTED' },
              ]),
            },
            masterOrder: {
              findUnique: jest.fn().mockResolvedValue({ orderStatus: 'SELLER_ACCEPTED' }),
              update: masterUpdate,
            },
          };
          return cb(tx);
        },
      });
      await svc.sellerUpdateFulfillmentStatus('sub-1', 'seller-1', 'SHIPPED', {
        trackingNumber: 'AWB12345678',
        courierName: 'DTDC',
      });
      expect(masterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { orderStatus: 'PARTIALLY_SHIPPED' },
        }),
      );
    });

    it('ignores REJECTED siblings when computing rollup', async () => {
      const masterUpdate = jest.fn().mockResolvedValue({});
      const { svc } = makeService({
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              { id: 'sub-1', fulfillment_status: 'PACKED', accept_status: 'ACCEPTED' },
            ]),
            subOrder: {
              update: jest.fn().mockResolvedValue({ id: 'sub-1' }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
                { id: 'sub-rejected', fulfillmentStatus: 'CANCELLED', acceptStatus: 'REJECTED' },
              ]),
            },
            masterOrder: {
              findUnique: jest.fn().mockResolvedValue({ orderStatus: 'SELLER_ACCEPTED' }),
              update: masterUpdate,
            },
          };
          return cb(tx);
        },
      });
      await svc.sellerUpdateFulfillmentStatus('sub-1', 'seller-1', 'SHIPPED', {
        trackingNumber: 'AWB12345678',
        courierName: 'DTDC',
      });
      // Only sub-1 is active; it's SHIPPED → DISPATCHED, NOT PARTIALLY_SHIPPED.
      expect(masterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { orderStatus: 'DISPATCHED' },
        }),
      );
    });
  });

  describe('Gap #18 — FOR UPDATE lock + inside-tx FSM re-check', () => {
    it('issues SELECT … FOR UPDATE inside the tx', async () => {
      const queryRaw = jest.fn().mockResolvedValue([
        { id: 'sub-1', fulfillment_status: 'PACKED', accept_status: 'ACCEPTED' },
      ]);
      const { svc } = makeService({
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: queryRaw,
            subOrder: {
              update: jest.fn().mockResolvedValue({ id: 'sub-1' }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
              ]),
            },
            masterOrder: {
              findUnique: jest.fn().mockResolvedValue({ orderStatus: 'SELLER_ACCEPTED' }),
              update: jest.fn(),
            },
          };
          return cb(tx);
        },
      });
      await svc.sellerUpdateFulfillmentStatus('sub-1', 'seller-1', 'SHIPPED', {
        trackingNumber: 'AWB12345678',
        courierName: 'DTDC',
      });
      const sql = queryRaw.mock.calls[0]![0];
      const joined = Array.isArray(sql) ? sql.join('?') : String(sql);
      expect(joined).toContain('FOR UPDATE');
    });

    it('throws ConflictAppException when sub-order acceptStatus changed under the lock (concurrent cancel)', async () => {
      const { svc } = makeService({
        txLockedRow: {
          id: 'sub-1',
          fulfillment_status: 'CANCELLED',
          accept_status: 'CANCELLED',
        },
      });
      await expect(
        svc.sellerUpdateFulfillmentStatus('sub-1', 'seller-1', 'SHIPPED', {
          trackingNumber: 'AWB12345678',
          courierName: 'DTDC',
        }),
      ).rejects.toThrow(ConflictAppException);
    });
  });

  describe('Gap #20 — env-driven evidence threshold', () => {
    it('uses ORDER_SHIPMENT_EVIDENCE_REQUIRED_PHOTOS env value', async () => {
      const { svc } = makeService({
        envEvidenceRequired: 2,
        evidenceCount: 2, // exactly meets the new threshold
      });
      await expect(
        svc.sellerUpdateFulfillmentStatus('sub-1', 'seller-1', 'SHIPPED', {
          trackingNumber: 'AWB12345678',
          courierName: 'DTDC',
        }),
      ).resolves.toBeDefined();
    });

    it('rejects when evidence count below env threshold', async () => {
      const { svc } = makeService({
        envEvidenceRequired: 4,
        evidenceCount: 3,
      });
      await expect(
        svc.sellerUpdateFulfillmentStatus('sub-1', 'seller-1', 'SHIPPED', {
          trackingNumber: 'AWB12345678',
          courierName: 'DTDC',
        }),
      ).rejects.toThrow(/4 shipment evidence photos/);
    });
  });

  describe('SHIPPED guards', () => {
    it('rejects SHIPPED without trackingNumber', async () => {
      const { svc } = makeService();
      await expect(
        svc.sellerUpdateFulfillmentStatus('sub-1', 'seller-1', 'SHIPPED', {
          courierName: 'DTDC',
        }),
      ).rejects.toThrow(/trackingNumber and courierName/);
    });

    it('rejects SHIPPED without courierName', async () => {
      const { svc } = makeService();
      await expect(
        svc.sellerUpdateFulfillmentStatus('sub-1', 'seller-1', 'SHIPPED', {
          trackingNumber: 'AWB12345678',
        }),
      ).rejects.toThrow(/trackingNumber and courierName/);
    });

    it('rejects DELIVERED with helpful error', async () => {
      const { svc } = makeService();
      await expect(
        svc.sellerUpdateFulfillmentStatus('sub-1', 'seller-1', 'DELIVERED'),
      ).rejects.toThrow(/Delivery must be confirmed by admin/);
    });

    it('rejects FULFILLED with deprecated error', async () => {
      const { svc } = makeService();
      await expect(
        svc.sellerUpdateFulfillmentStatus('sub-1', 'seller-1', 'FULFILLED'),
      ).rejects.toThrow(/FULFILLED status is deprecated/);
    });

    it('rejects when acceptStatus is not ACCEPTED', async () => {
      const { svc } = makeService({
        subOrder: {
          id: 'sub-1',
          masterOrderId: 'master-1',
          sellerId: 'seller-1',
          fulfillmentStatus: 'UNFULFILLED',
          acceptStatus: 'OPEN',
          items: [],
        },
      });
      await expect(
        svc.sellerUpdateFulfillmentStatus('sub-1', 'seller-1', 'PACKED'),
      ).rejects.toThrow(BadRequestAppException);
    });
  });
});

describe('UpdateFulfillmentStatusDto (Phase 82 Gap #11)', () => {
  const validate_ = async (input: any) => {
    const dto = plainToInstance(UpdateFulfillmentStatusDto, input);
    return validate(dto);
  };

  it('accepts valid PACKED', async () => {
    const errors = await validate_({ status: 'PACKED' });
    expect(errors).toHaveLength(0);
  });

  it('accepts valid SHIPPED with tracking + courier', async () => {
    const errors = await validate_({
      status: 'SHIPPED',
      trackingNumber: 'AWB12345678',
      courierName: 'DTDC',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects DELIVERED at DTO layer (only PACKED/SHIPPED allowed)', async () => {
    const errors = await validate_({ status: 'DELIVERED' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects FULFILLED at DTO layer', async () => {
    const errors = await validate_({ status: 'FULFILLED' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects trackingNumber with special characters', async () => {
    const errors = await validate_({
      status: 'SHIPPED',
      trackingNumber: '<script>',
      courierName: 'DTDC',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects trackingNumber under 8 chars', async () => {
    const errors = await validate_({
      status: 'SHIPPED',
      trackingNumber: 'AB12',
      courierName: 'DTDC',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects unknown courier name', async () => {
    const errors = await validate_({
      status: 'SHIPPED',
      trackingNumber: 'AWB12345678',
      courierName: 'FedEx-Custom',
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
