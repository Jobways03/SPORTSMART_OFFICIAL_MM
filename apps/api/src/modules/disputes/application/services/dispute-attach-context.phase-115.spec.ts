// Phase 115 — attach-context seller-ownership parity + sub-order backfill.
//
// The customer path already rejected attaching another customer's order/return;
// the seller path didn't, letting a seller-filed dispute attach ANY seller's
// order/return (cross-tenant). These tests pin the seller checks + the backfill.

import { DisputeService } from './dispute.service';

function build(prismaOverrides: any = {}) {
  const prisma: any = {
    dispute: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({
        id: 'd1', masterOrderId: 'mo-1', subOrderId: 'so-1', returnId: 'ret-1',
      }),
    },
    return: { findUnique: jest.fn() },
    masterOrder: { findUnique: jest.fn() },
    subOrder: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    ...prismaOverrides,
  };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new DisputeService(
    prisma as any, eventBus as any, audit as any,
    {} as any, {} as any, {} as any,
  );
  return { service, prisma };
}

const sellerDispute = {
  id: 'd1', status: 'UNDER_REVIEW',
  filedByType: 'SELLER', filedById: 'seller-1',
  masterOrderId: null, subOrderId: null, returnId: null,
};

describe('DisputeService.attachContext — seller-ownership parity (Phase 115)', () => {
  it("rejects a seller attaching a return on another seller's sub-order", async () => {
    const { service, prisma } = build();
    prisma.dispute.findUnique.mockResolvedValue(sellerDispute);
    prisma.return.findUnique.mockResolvedValue({
      id: 'ret-1', customerId: 'c1', masterOrderId: 'mo-1', subOrderId: 'so-x',
    });
    prisma.subOrder.findUnique.mockResolvedValue({ sellerId: 'other-seller' });
    await expect(
      service.attachContext({ disputeId: 'd1', adminId: 'a1', returnNumber: 'RET-1' }),
    ).rejects.toThrow(/does not belong/i);
    expect(prisma.dispute.update).not.toHaveBeenCalled();
  });

  it("rejects a seller attaching an order with no sub-order they own", async () => {
    const { service, prisma } = build();
    prisma.dispute.findUnique.mockResolvedValue(sellerDispute);
    prisma.masterOrder.findUnique.mockResolvedValue({ id: 'mo-1', customerId: 'c1' });
    prisma.subOrder.findMany.mockResolvedValue([{ id: 'so-1', sellerId: 'other-seller' }]);
    await expect(
      service.attachContext({ disputeId: 'd1', adminId: 'a1', orderNumber: 'SM-1' }),
    ).rejects.toThrow(/no sub-order belonging/i);
    expect(prisma.dispute.update).not.toHaveBeenCalled();
  });

  it("allows a seller attaching a return on their OWN sub-order", async () => {
    const { service, prisma } = build();
    prisma.dispute.findUnique.mockResolvedValue(sellerDispute);
    prisma.return.findUnique.mockResolvedValue({
      id: 'ret-1', customerId: 'c1', masterOrderId: 'mo-1', subOrderId: 'so-1',
    });
    prisma.subOrder.findUnique.mockResolvedValue({ sellerId: 'seller-1' });
    await service.attachContext({ disputeId: 'd1', adminId: 'a1', returnNumber: 'RET-1' });
    expect(prisma.dispute.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ returnId: 'ret-1', subOrderId: 'so-1' }),
      }),
    );
  });

  it('backfills subOrderId when an admin attaches an order with exactly one sub-order', async () => {
    const { service, prisma } = build();
    prisma.dispute.findUnique.mockResolvedValue({
      ...sellerDispute, filedByType: 'ADMIN', filedById: 'a1',
    });
    prisma.masterOrder.findUnique.mockResolvedValue({ id: 'mo-1', customerId: 'c1' });
    prisma.subOrder.findMany.mockResolvedValue([{ id: 'so-only', sellerId: 's1' }]);
    await service.attachContext({ disputeId: 'd1', adminId: 'a1', orderNumber: 'SM-1' });
    expect(prisma.dispute.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ masterOrderId: 'mo-1', subOrderId: 'so-only' }),
      }),
    );
  });
});
