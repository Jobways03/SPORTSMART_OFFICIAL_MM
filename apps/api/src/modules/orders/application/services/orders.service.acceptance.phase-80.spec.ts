// Phase 80 (2026-05-22) — sub-order acceptance hardening.
//
// Covers the audit gaps that touch OrdersService.sellerAcceptOrder
// and OrdersService.sellerRejectOrder:
//
//   Gap #1/#9 — env-driven deadline (this.acceptDeadlineMs())
//   Gap #4    — late-accept blocked at the service layer
//   Gap #6/#19 — rejectionType=AUTO_SLA written by the cron path;
//                MANUAL by the seller path
//   Gap #7    — acceptedAt / acceptedBy on accept; rejectedAt /
//                rejectedBy on reject
//   Gap #17   — FOR UPDATE row lock + inside-tx re-check
//   Gap #21   — audit log row per accept/reject
//
// The cron-side franchise branch is exercised at integration level
// via the processor spec.

import { OrdersService } from './orders.service';
import { BadRequestAppException } from '../../../../core/exceptions';

interface FakeTx {
  $queryRaw: jest.Mock;
  subOrder: { update: jest.Mock };
}

function makeService(opts?: {
  subOrder?: any;
  txLockedRow?: any;
  envSlaMinutes?: number;
}) {
  const subOrder = opts?.subOrder ?? {
    id: 'sub-1',
    masterOrderId: 'master-1',
    sellerId: 'seller-1',
    acceptStatus: 'OPEN',
    acceptDeadlineAt: new Date(Date.now() + 30 * 60 * 1000),
  };

  const lockedRow = opts?.txLockedRow ?? {
    id: 'sub-1',
    accept_status: 'OPEN',
    accept_deadline_at: subOrder.acceptDeadlineAt,
  };

  const orderRepo: any = {
    findSubOrderForSellerBasic: jest.fn().mockResolvedValue(subOrder),
    findSubOrderForSellerWithDetails: jest.fn().mockResolvedValue({
      ...subOrder,
      items: [],
      masterOrder: {
        id: subOrder.masterOrderId,
        orderNumber: 'ORD-1',
        shippingAddressSnapshot: { postalCode: '600001' },
      },
    }),
    updateSubOrder: jest.fn().mockResolvedValue({}),
    updateMasterOrder: jest.fn().mockResolvedValue({}),
    findStockReservations: jest.fn().mockResolvedValue([]),
    restoreStockFromConfirmedReservation: jest.fn(),
    releaseReservedStock: jest.fn(),
    findSubOrdersByMasterOrder: jest.fn().mockResolvedValue([]),
    findSellerProductMappingIds: jest.fn().mockResolvedValue([]),
    createReassignmentLog: jest.fn().mockResolvedValue({}),
    executeTransaction: jest.fn().mockImplementation(async (cb: any) => cb({})),
  };

  const txUpdate = jest.fn().mockResolvedValue({
    id: subOrder.id,
    acceptStatus: 'ACCEPTED',
    acceptedAt: new Date(),
    acceptedBy: subOrder.sellerId,
  });
  const txRejectUpdate = jest.fn().mockResolvedValue({});
  let lastUpdateArgs: any = null;
  const txMock = {
    $queryRaw: jest.fn().mockResolvedValue([lockedRow]),
    subOrder: {
      update: jest.fn().mockImplementation((args: any) => {
        lastUpdateArgs = args.data;
        if (args.data.acceptStatus === 'ACCEPTED') return txUpdate(args);
        return txRejectUpdate(args);
      }),
    },
  };

  const prisma: any = {
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(txMock)),
    masterOrder: { update: jest.fn() },
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const taxFacade: any = { generateInvoiceForSubOrder: jest.fn() };
  const auditFacade: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const env: any = {
    getNumber: (k: string, d: number) => {
      if (k === 'ORDER_ACCEPTANCE_SLA_MINUTES') return opts?.envSlaMinutes ?? 60;
      return d;
    },
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
  );

  return {
    svc,
    orderRepo,
    prisma,
    eventBus,
    auditFacade,
    txUpdate,
    txRejectUpdate,
    txMock,
    getLastUpdateArgs: () => lastUpdateArgs,
  };
}

describe('OrdersService.sellerAcceptOrder (Phase 80)', () => {
  it('Gap #4 — rejects late accept (deadline already passed)', async () => {
    const past = new Date(Date.now() - 60_000);
    const { svc } = makeService({
      subOrder: {
        id: 'sub-1',
        masterOrderId: 'master-1',
        sellerId: 'seller-1',
        acceptStatus: 'OPEN',
        acceptDeadlineAt: past,
      },
    });
    await expect(
      svc.sellerAcceptOrder('sub-1', 'seller-1'),
    ).rejects.toThrow(BadRequestAppException);
  });

  it('Gap #4 — allows accept just before deadline', async () => {
    const future = new Date(Date.now() + 60_000);
    const { svc } = makeService({
      subOrder: {
        id: 'sub-1',
        masterOrderId: 'master-1',
        sellerId: 'seller-1',
        acceptStatus: 'OPEN',
        acceptDeadlineAt: future,
      },
      txLockedRow: {
        id: 'sub-1',
        accept_status: 'OPEN',
        accept_deadline_at: future,
      },
    });
    await expect(
      svc.sellerAcceptOrder('sub-1', 'seller-1'),
    ).resolves.toBeDefined();
  });

  it('Gap #7 — stamps acceptedAt + acceptedBy on accept', async () => {
    const { svc, getLastUpdateArgs } = makeService();
    await svc.sellerAcceptOrder('sub-1', 'seller-1');
    const args = getLastUpdateArgs();
    expect(args.acceptStatus).toBe('ACCEPTED');
    expect(args.acceptedBy).toBe('seller-1');
    expect(args.acceptedAt).toBeInstanceOf(Date);
  });

  it('Gap #17 — uses FOR UPDATE inside a tx', async () => {
    const { svc, txMock } = makeService();
    await svc.sellerAcceptOrder('sub-1', 'seller-1');
    // Raw `SELECT ... FOR UPDATE` was issued inside the tx.
    expect(txMock.$queryRaw).toHaveBeenCalled();
    const queryFragments = txMock.$queryRaw.mock.calls[0]![0];
    const sql = Array.isArray(queryFragments) ? queryFragments.join('?') : String(queryFragments);
    expect(sql).toContain('FOR UPDATE');
  });

  it('Gap #17 — inside-lock re-check throws when status raced to non-OPEN', async () => {
    const { svc } = makeService({
      txLockedRow: {
        id: 'sub-1',
        accept_status: 'REJECTED',
        accept_deadline_at: new Date(Date.now() + 60_000),
      },
    });
    await expect(
      svc.sellerAcceptOrder('sub-1', 'seller-1'),
    ).rejects.toThrow();
  });

  it('Gap #21 — writes audit log row on accept', async () => {
    const { svc, auditFacade } = makeService();
    await svc.sellerAcceptOrder('sub-1', 'seller-1');
    expect(auditFacade.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'seller-1',
        actorRole: 'SELLER',
        action: 'SUB_ORDER_ACCEPTED',
        module: 'orders',
        resource: 'SubOrder',
        resourceId: 'sub-1',
      }),
    );
  });
});

describe('OrdersService.sellerRejectOrder (Phase 80)', () => {
  it('Gap #19 — MANUAL rejectionType when auto flag not set', async () => {
    const { svc, getLastUpdateArgs } = makeService();
    await svc.sellerRejectOrder('sub-1', 'seller-1', { reason: 'OUT_OF_STOCK' });
    const args = getLastUpdateArgs();
    expect(args.rejectionType).toBe('MANUAL');
    expect(args.autoRejectedAt).toBeNull();
  });

  it('Gap #19 — AUTO_SLA rejectionType + autoRejectedAt when auto=true', async () => {
    const { svc, getLastUpdateArgs } = makeService();
    await svc.sellerRejectOrder('sub-1', 'seller-1', {
      reason: 'OTHER',
      auto: true,
    });
    const args = getLastUpdateArgs();
    expect(args.rejectionType).toBe('AUTO_SLA');
    expect(args.autoRejectedAt).toBeInstanceOf(Date);
  });

  it('Gap #7 — stamps rejectedAt + rejectedBy on reject', async () => {
    const { svc, getLastUpdateArgs } = makeService();
    await svc.sellerRejectOrder('sub-1', 'seller-1', {
      reason: 'CANNOT_SHIP',
    });
    const args = getLastUpdateArgs();
    expect(args.rejectedAt).toBeInstanceOf(Date);
    expect(args.rejectedBy).toBe('seller-1');
  });

  it('Gap #21 — manual reject writes audit log with action=SUB_ORDER_REJECTED', async () => {
    const { svc, auditFacade } = makeService();
    await svc.sellerRejectOrder('sub-1', 'seller-1', { reason: 'CANNOT_SHIP' });
    expect(auditFacade.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SUB_ORDER_REJECTED',
        actorRole: 'SELLER',
      }),
    );
  });

  it('Gap #21 — auto reject writes audit log with action=SUB_ORDER_AUTO_REJECTED + actorRole=SYSTEM', async () => {
    const { svc, auditFacade } = makeService();
    await svc.sellerRejectOrder('sub-1', 'seller-1', {
      reason: 'OTHER',
      auto: true,
    });
    expect(auditFacade.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SUB_ORDER_AUTO_REJECTED',
        actorRole: 'SYSTEM',
        actorId: null,
      }),
    );
  });

  it('Gap #17 — uses FOR UPDATE inside a tx', async () => {
    const { svc, txMock } = makeService();
    await svc.sellerRejectOrder('sub-1', 'seller-1', { reason: 'CANNOT_SHIP' });
    expect(txMock.$queryRaw).toHaveBeenCalled();
  });
});

describe('OrdersService.acceptDeadlineMs (Phase 80, Gap #1/#9)', () => {
  it('reads from ORDER_ACCEPTANCE_SLA_MINUTES env', () => {
    const { svc } = makeService({ envSlaMinutes: 30 });
    // Private method — access via any cast in this unit-level test.
    expect((svc as any).acceptDeadlineMs()).toBe(30 * 60 * 1000);
  });

  it('falls back to 24h when SLA env is 0 (disabled)', () => {
    const { svc } = makeService({ envSlaMinutes: 0 });
    expect((svc as any).acceptDeadlineMs()).toBe(24 * 60 * 60 * 1000);
  });

  it('falls back to 24h when SLA env is negative (operator typo)', () => {
    const { svc } = makeService({ envSlaMinutes: -10 });
    expect((svc as any).acceptDeadlineMs()).toBe(24 * 60 * 60 * 1000);
  });
});
