// Phase 85 (2026-05-23) — manual AWB attachment hardening.
//
// Covers ShippingPublicFacade.attachAwb:
//   Gap #2/#3   FSM gate + acceptStatus='ACCEPTED' precondition
//   Gap #5      Master rollup (PARTIALLY_SHIPPED / DISPATCHED)
//   Gap #6      Tax invoice generation post-tx
//   Gap #7      Audit log + timeline event written inside tx
//   Gap #8      Writes to trackingUrl column (not shippingLabelUrl)
//   Gap #11     awbAttachedAt / awbAttachedBy / awbAttachmentSource persisted
//   Gap #12     AWB collision (P2002) raises ConflictAppException
//   Gap #13     SubOrderAwbHistory row inserted; prior active detached
//   Gap #17     FOR UPDATE row lock present
//   Gap #19     Overwrite without replace=true rejected; with replace=true succeeds
//   Gap #20     orders.sub_order.status_changed event published with metadata

import { ShippingPublicFacade } from './shipping-public.facade';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

interface FakeTx {
  $queryRaw: jest.Mock;
  subOrder: { update: jest.Mock; findMany: jest.Mock };
  subOrderAwbHistory: { create: jest.Mock; updateMany: jest.Mock };
  masterOrder: { findUnique: jest.Mock; update: jest.Mock };
}

function makeFacade(opts?: {
  lockedRow?: any;
  siblings?: any[];
  masterStatus?: string;
  updateImpl?: jest.Mock;
  txExec?: (cb: (tx: FakeTx) => Promise<any>) => Promise<any>;
}) {
  const lockedRow = opts?.lockedRow ?? {
    id: 'sub-1',
    accept_status: 'ACCEPTED',
    fulfillment_status: 'PACKED',
    master_order_id: 'master-1',
    tracking_number: null,
  };
  const siblings = opts?.siblings ?? [
    { id: 'sub-1', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
  ];
  const masterStatus = opts?.masterStatus ?? 'SELLER_ACCEPTED';

  const txUpdate =
    opts?.updateImpl ??
    jest.fn().mockResolvedValue({
      id: 'sub-1',
      fulfillmentStatus: 'SHIPPED',
      trackingNumber: 'AWB12345678',
      courierName: 'DTDC',
      trackingUrl: 'https://www.dtdc.in/tracking/...AWB12345678',
    });
  const txMock: FakeTx = {
    $queryRaw: jest.fn().mockResolvedValue([lockedRow]),
    subOrder: {
      update: txUpdate,
      findMany: jest.fn().mockResolvedValue(siblings),
    },
    subOrderAwbHistory: {
      create: jest.fn().mockResolvedValue({ id: 'hist-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    masterOrder: {
      findUnique: jest.fn().mockResolvedValue({ orderStatus: masterStatus }),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const prisma: any = {
    $transaction:
      opts?.txExec ??
      (async (cb: any) => cb(txMock)),
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const auditFacade: any = {
    writeAuditLog: jest.fn().mockResolvedValue(undefined),
  };
  const taxFacade: any = {
    generateInvoiceForSubOrder: jest.fn().mockResolvedValue(undefined),
  };
  const timeline: any = {
    record: jest.fn().mockResolvedValue('evt-1'),
  };

  const facade = new ShippingPublicFacade(
    prisma,
    eventBus,
    auditFacade,
    taxFacade,
    timeline,
  );
  return { facade, eventBus, auditFacade, taxFacade, timeline, txMock };
}

describe('ShippingPublicFacade.attachAwb (Phase 85)', () => {
  describe('Gap #3 — acceptStatus precondition', () => {
    it('rejects when sub-order acceptStatus is OPEN', async () => {
      const { facade } = makeFacade({
        lockedRow: {
          id: 'sub-1',
          accept_status: 'OPEN',
          fulfillment_status: 'UNFULFILLED',
          master_order_id: 'master-1',
          tracking_number: null,
        },
      });
      await expect(
        facade.attachAwb('sub-1', {
          courierName: 'DTDC',
          awb: 'AWB12345678',
        }),
      ).rejects.toThrow(/ACCEPTED before attaching AWB/);
    });

    it('rejects when sub-order acceptStatus is REJECTED', async () => {
      const { facade } = makeFacade({
        lockedRow: {
          id: 'sub-1',
          accept_status: 'REJECTED',
          fulfillment_status: 'UNFULFILLED',
          master_order_id: 'master-1',
          tracking_number: null,
        },
      });
      await expect(
        facade.attachAwb('sub-1', {
          courierName: 'DTDC',
          awb: 'AWB12345678',
        }),
      ).rejects.toThrow(BadRequestAppException);
    });
  });

  describe('Gap #2 — FSM gate', () => {
    it('rejects when fulfillment_status is CANCELLED', async () => {
      const { facade } = makeFacade({
        lockedRow: {
          id: 'sub-1',
          accept_status: 'ACCEPTED',
          fulfillment_status: 'CANCELLED',
          master_order_id: 'master-1',
          tracking_number: null,
        },
      });
      await expect(
        facade.attachAwb('sub-1', {
          courierName: 'DTDC',
          awb: 'AWB12345678',
        }),
      ).rejects.toThrow(/Illegal OrderFulfillmentStatus transition/);
    });

    it('rejects when fulfillment_status is DELIVERED', async () => {
      const { facade } = makeFacade({
        lockedRow: {
          id: 'sub-1',
          accept_status: 'ACCEPTED',
          fulfillment_status: 'DELIVERED',
          master_order_id: 'master-1',
          tracking_number: null,
        },
      });
      await expect(
        facade.attachAwb('sub-1', {
          courierName: 'DTDC',
          awb: 'AWB12345678',
        }),
      ).rejects.toThrow();
    });

    it('accepts when fulfillment_status is PACKED (canonical pre-ship state)', async () => {
      const { facade } = makeFacade({
        lockedRow: {
          id: 'sub-1',
          accept_status: 'ACCEPTED',
          fulfillment_status: 'PACKED',
          master_order_id: 'master-1',
          tracking_number: null,
        },
      });
      await expect(
        facade.attachAwb('sub-1', {
          courierName: 'DTDC',
          awb: 'AWB12345678',
        }),
      ).resolves.toBeDefined();
    });

    it('rejects skip-PACKED (UNFULFILLED → SHIPPED is not in the FSM matrix)', async () => {
      // Phase 85 admin override is symmetric with the seller path:
      // both require PACKED as the source state. The FSM blocks
      // UNFULFILLED → SHIPPED so an admin can't bypass the pack step.
      const { facade } = makeFacade({
        lockedRow: {
          id: 'sub-1',
          accept_status: 'ACCEPTED',
          fulfillment_status: 'UNFULFILLED',
          master_order_id: 'master-1',
          tracking_number: null,
        },
      });
      await expect(
        facade.attachAwb('sub-1', {
          courierName: 'DTDC',
          awb: 'AWB12345678',
        }),
      ).rejects.toThrow(/UNFULFILLED.*SHIPPED/);
    });
  });

  describe('Gap #11 — audit columns persisted', () => {
    it('writes awbAttachedAt + awbAttachedBy + awbAttachmentSource', async () => {
      let updateArgs: any = null;
      const { facade } = makeFacade({
        updateImpl: jest.fn().mockImplementation((args: any) => {
          updateArgs = args.data;
          return Promise.resolve({
            id: 'sub-1',
            fulfillmentStatus: 'SHIPPED',
            trackingNumber: args.data.trackingNumber,
            courierName: args.data.courierName,
            trackingUrl: args.data.trackingUrl,
          });
        }),
      });
      await facade.attachAwb(
        'sub-1',
        { courierName: 'DTDC', awb: 'AWB12345678' },
        'admin-42',
      );
      expect(updateArgs.awbAttachedAt).toBeInstanceOf(Date);
      expect(updateArgs.awbAttachedBy).toBe('admin-42');
      expect(updateArgs.awbAttachmentSource).toBe('ADMIN_OVERRIDE');
    });
  });

  describe('Gap #8 — trackingUrl column (not shippingLabelUrl)', () => {
    it('writes derived trackingUrl from courier mapping', async () => {
      let updateArgs: any = null;
      const { facade } = makeFacade({
        updateImpl: jest.fn().mockImplementation((args: any) => {
          updateArgs = args.data;
          return Promise.resolve({
            id: 'sub-1',
            fulfillmentStatus: 'SHIPPED',
            trackingNumber: args.data.trackingNumber,
            courierName: args.data.courierName,
            trackingUrl: args.data.trackingUrl,
          });
        }),
      });
      await facade.attachAwb('sub-1', {
        courierName: 'DTDC',
        awb: 'AWB12345678',
      });
      expect(updateArgs.trackingUrl).toContain('dtdc');
      expect(updateArgs.trackingUrl).toContain('AWB12345678');
      // shippingLabelUrl NOT written by Phase 85.
      expect(updateArgs.shippingLabelUrl).toBeUndefined();
    });

    it('caller-supplied trackingUrl override wins over the mapping default', async () => {
      let updateArgs: any = null;
      const { facade } = makeFacade({
        updateImpl: jest.fn().mockImplementation((args: any) => {
          updateArgs = args.data;
          return Promise.resolve({
            id: 'sub-1',
            fulfillmentStatus: 'SHIPPED',
            trackingNumber: args.data.trackingNumber,
            courierName: args.data.courierName,
            trackingUrl: args.data.trackingUrl,
          });
        }),
      });
      await facade.attachAwb('sub-1', {
        courierName: 'DTDC',
        awb: 'AWB12345678',
        trackingUrl: 'https://override.example/track/AWB12345678',
      });
      expect(updateArgs.trackingUrl).toBe(
        'https://override.example/track/AWB12345678',
      );
    });
  });

  describe('Gap #19 — overwrite guard', () => {
    it('rejects when prior AWB exists without replace=true', async () => {
      const { facade } = makeFacade({
        lockedRow: {
          id: 'sub-1',
          accept_status: 'ACCEPTED',
          fulfillment_status: 'PACKED',
          master_order_id: 'master-1',
          tracking_number: 'AWB_PREV_99',
        },
      });
      await expect(
        facade.attachAwb('sub-1', {
          courierName: 'DTDC',
          awb: 'AWB_NEW_88',
        }),
      ).rejects.toThrow(ConflictAppException);
    });

    it('accepts overwrite with replace=true + reason; detaches prior history row', async () => {
      const txDetachMany = jest.fn().mockResolvedValue({ count: 1 });
      const txCreateHist = jest.fn().mockResolvedValue({ id: 'hist-new' });
      const { facade } = makeFacade({
        lockedRow: {
          id: 'sub-1',
          accept_status: 'ACCEPTED',
          fulfillment_status: 'PACKED',
          master_order_id: 'master-1',
          tracking_number: 'AWB_PREV_99',
        },
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              {
                id: 'sub-1',
                accept_status: 'ACCEPTED',
                fulfillment_status: 'PACKED',
                master_order_id: 'master-1',
                tracking_number: 'AWB_PREV_99',
              },
            ]),
            subOrder: {
              update: jest.fn().mockResolvedValue({
                id: 'sub-1',
                fulfillmentStatus: 'SHIPPED',
                trackingNumber: 'AWB_NEW_88',
                courierName: 'DTDC',
                trackingUrl: 'https://dtdc.in/track/AWB_NEW_88',
              }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
              ]),
            },
            subOrderAwbHistory: {
              create: txCreateHist,
              updateMany: txDetachMany,
            },
            masterOrder: {
              findUnique: jest.fn().mockResolvedValue({ orderStatus: 'SELLER_ACCEPTED' }),
              update: jest.fn(),
            },
          };
          return cb(tx);
        },
      });
      await facade.attachAwb(
        'sub-1',
        {
          courierName: 'DTDC',
          awb: 'AWB_NEW_88',
          replace: true,
          reason: 'Original AWB had typo',
        },
        'admin-1',
      );
      // Prior active row detached.
      expect(txDetachMany).toHaveBeenCalledWith({
        where: { subOrderId: 'sub-1', detachedAt: null },
        data: { detachedAt: expect.any(Date) },
      });
      // New history row inserted.
      expect(txCreateHist).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            awbNumber: 'AWB_NEW_88',
            reason: 'Original AWB had typo',
            attachmentSource: 'ADMIN_OVERRIDE',
          }),
        }),
      );
    });
  });

  describe('Gap #12 — AWB uniqueness collision', () => {
    it('translates Prisma P2002 to ConflictAppException', async () => {
      const { facade } = makeFacade({
        updateImpl: jest.fn().mockRejectedValue({
          code: 'P2002',
          meta: { target: ['tracking_number'] },
        }),
      });
      await expect(
        facade.attachAwb('sub-1', {
          courierName: 'DTDC',
          awb: 'AWB12345678',
        }),
      ).rejects.toThrow(/already attached to another sub-order/);
    });
  });

  describe('Gap #5 — master rollup', () => {
    it('flips master to DISPATCHED when all active sub-orders shipped', async () => {
      const masterUpdate = jest.fn().mockResolvedValue({});
      const { facade } = makeFacade({
        siblings: [
          { id: 'sub-1', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
          { id: 'sub-2', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
        ],
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              {
                id: 'sub-1',
                accept_status: 'ACCEPTED',
                fulfillment_status: 'PACKED',
                master_order_id: 'master-1',
                tracking_number: null,
              },
            ]),
            subOrder: {
              update: jest.fn().mockResolvedValue({
                id: 'sub-1',
                fulfillmentStatus: 'SHIPPED',
                trackingNumber: 'AWB12345678',
                courierName: 'DTDC',
                trackingUrl: 'https://dtdc.in/track/AWB12345678',
              }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
                { id: 'sub-2', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
              ]),
            },
            subOrderAwbHistory: {
              create: jest.fn().mockResolvedValue({}),
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            masterOrder: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ orderStatus: 'SELLER_ACCEPTED' }),
              update: masterUpdate,
            },
          };
          return cb(tx);
        },
      });
      await facade.attachAwb('sub-1', {
        courierName: 'DTDC',
        awb: 'AWB12345678',
      });
      expect(masterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { orderStatus: 'DISPATCHED' } }),
      );
    });

    it('flips master to PARTIALLY_SHIPPED when some siblings still pending', async () => {
      const masterUpdate = jest.fn().mockResolvedValue({});
      const { facade } = makeFacade({
        siblings: [
          { id: 'sub-1', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
          { id: 'sub-2', fulfillmentStatus: 'PACKED', acceptStatus: 'ACCEPTED' },
        ],
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([
              {
                id: 'sub-1',
                accept_status: 'ACCEPTED',
                fulfillment_status: 'PACKED',
                master_order_id: 'master-1',
                tracking_number: null,
              },
            ]),
            subOrder: {
              update: jest.fn().mockResolvedValue({
                id: 'sub-1',
                fulfillmentStatus: 'SHIPPED',
                trackingNumber: 'AWB12345678',
                courierName: 'DTDC',
                trackingUrl: 'https://dtdc.in/track/AWB12345678',
              }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
                { id: 'sub-2', fulfillmentStatus: 'PACKED', acceptStatus: 'ACCEPTED' },
              ]),
            },
            subOrderAwbHistory: {
              create: jest.fn().mockResolvedValue({}),
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            masterOrder: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ orderStatus: 'SELLER_ACCEPTED' }),
              update: masterUpdate,
            },
          };
          return cb(tx);
        },
      });
      await facade.attachAwb('sub-1', {
        courierName: 'DTDC',
        awb: 'AWB12345678',
      });
      expect(masterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { orderStatus: 'PARTIALLY_SHIPPED' },
        }),
      );
    });
  });

  describe('Gap #6 — tax invoice generation', () => {
    it('fires generateInvoiceForSubOrder post-tx', async () => {
      const { facade, taxFacade } = makeFacade();
      await facade.attachAwb('sub-1', {
        courierName: 'DTDC',
        awb: 'AWB12345678',
      });
      expect(taxFacade.generateInvoiceForSubOrder).toHaveBeenCalledWith(
        'sub-1',
      );
    });
  });

  describe('Gap #7 — audit log + timeline', () => {
    it('writes audit_log inside the tx with action=SUB_ORDER_AWB_ATTACHED', async () => {
      const { facade, auditFacade } = makeFacade();
      await facade.attachAwb(
        'sub-1',
        { courierName: 'DTDC', awb: 'AWB12345678' },
        'admin-1',
      );
      expect(auditFacade.writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SUB_ORDER_AWB_ATTACHED',
          actorRole: 'ADMIN',
          actorId: 'admin-1',
          resource: 'SubOrder',
          resourceId: 'sub-1',
        }),
      );
    });

    it('writes timeline SUBORDER_SHIPPED event', async () => {
      const { facade, timeline } = makeFacade();
      await facade.attachAwb('sub-1', {
        courierName: 'DTDC',
        awb: 'AWB12345678',
      });
      expect(timeline.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'SUBORDER_SHIPPED',
          newStatus: 'SHIPPED',
          actorType: 'ADMIN',
          metadata: expect.objectContaining({
            trackingNumber: 'AWB12345678',
            source: 'ADMIN_OVERRIDE',
          }),
        }),
        expect.any(Object),
      );
    });
  });

  describe('Gap #20 — event publish', () => {
    it('publishes orders.sub_order.status_changed with tx', async () => {
      const { facade, eventBus } = makeFacade();
      await facade.attachAwb(
        'sub-1',
        { courierName: 'DTDC', awb: 'AWB12345678' },
        'admin-1',
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'orders.sub_order.status_changed',
          payload: expect.objectContaining({
            adminId: 'admin-1',
            trackingNumber: 'AWB12345678',
            awbAttachmentSource: 'ADMIN_OVERRIDE',
          }),
        }),
        expect.objectContaining({ tx: expect.anything() }),
      );
    });
  });

  describe('Gap #17 — FOR UPDATE row lock', () => {
    it('issues SELECT … FOR UPDATE inside the tx', async () => {
      const queryRaw = jest.fn().mockResolvedValue([
        {
          id: 'sub-1',
          accept_status: 'ACCEPTED',
          fulfillment_status: 'PACKED',
          master_order_id: 'master-1',
          tracking_number: null,
        },
      ]);
      const { facade } = makeFacade({
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: queryRaw,
            subOrder: {
              update: jest.fn().mockResolvedValue({
                id: 'sub-1',
                fulfillmentStatus: 'SHIPPED',
                trackingNumber: 'AWB12345678',
                courierName: 'DTDC',
                trackingUrl: null,
              }),
              findMany: jest.fn().mockResolvedValue([
                { id: 'sub-1', fulfillmentStatus: 'SHIPPED', acceptStatus: 'ACCEPTED' },
              ]),
            },
            subOrderAwbHistory: {
              create: jest.fn().mockResolvedValue({}),
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            masterOrder: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ orderStatus: 'SELLER_ACCEPTED' }),
              update: jest.fn(),
            },
          };
          return cb(tx);
        },
      });
      await facade.attachAwb('sub-1', {
        courierName: 'DTDC',
        awb: 'AWB12345678',
      });
      const sql = queryRaw.mock.calls[0]![0];
      const joined = Array.isArray(sql) ? sql.join('?') : String(sql);
      expect(joined).toContain('FOR UPDATE');
    });
  });

  describe('sub-order not found', () => {
    it('throws NotFoundAppException when locked row missing', async () => {
      const { facade } = makeFacade({
        txExec: async (cb) => {
          const tx: FakeTx = {
            $queryRaw: jest.fn().mockResolvedValue([]),
            subOrder: { update: jest.fn(), findMany: jest.fn() },
            subOrderAwbHistory: {
              create: jest.fn(),
              updateMany: jest.fn(),
            },
            masterOrder: { findUnique: jest.fn(), update: jest.fn() },
          };
          return cb(tx);
        },
      });
      await expect(
        facade.attachAwb('sub-missing', {
          courierName: 'DTDC',
          awb: 'AWB12345678',
        }),
      ).rejects.toThrow(NotFoundAppException);
    });
  });
});
