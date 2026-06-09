// Phase 92 follow-up (2026-05-23) — deferral closures.
//
//   Gap #16 — OrdersPublicFacade refactor takes precedence; fallback to
//             direct Prisma when facade is absent.
//   Gap #21 — Eligibility audit log written best-effort with IP/UA.

import { ReturnEligibilityService } from './return-eligibility.service';

function buildPrisma(masterOrder: any = null) {
  return {
    masterOrder: { findFirst: jest.fn().mockResolvedValue(masterOrder) },
    subOrder: { findFirst: jest.fn() },
    returnItem: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    returnEligibilityAudit: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn(),
  };
}

const returnRepo: any = {
  getReturnedQuantityForOrderItem: jest.fn().mockResolvedValue(0),
};
const caseDuplicates: any = {
  assertNoActiveReturnForOrderItem: jest.fn().mockResolvedValue(undefined),
};
const env: any = {
  getNumber: jest.fn().mockImplementation((_k: string, d: number) => d),
};

describe('ReturnEligibilityService — Phase 92 follow-up', () => {
  describe('Gap #16 — facade refactor', () => {
    it('uses OrdersPublicFacade when provided', async () => {
      const prisma = buildPrisma(null);
      const ordersFacade: any = {
        getMasterOrderWithDeliveredSubOrders: jest
          .fn()
          .mockResolvedValue(null),
      };
      const svc = new ReturnEligibilityService(
        prisma as any,
        returnRepo,
        caseDuplicates,
        env,
        ordersFacade,
      );
      await svc.checkOrderEligibility('order-1', 'cust-1');
      expect(
        ordersFacade.getMasterOrderWithDeliveredSubOrders,
      ).toHaveBeenCalledWith('order-1', 'cust-1', {
        excludeMasterStatuses: ['CANCELLED', 'REJECTED'],
      });
      expect(prisma.masterOrder.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to direct Prisma when facade is undefined', async () => {
      const prisma = buildPrisma(null);
      const svc = new ReturnEligibilityService(
        prisma as any,
        returnRepo,
        caseDuplicates,
        env,
      );
      await svc.checkOrderEligibility('order-1', 'cust-1');
      expect(prisma.masterOrder.findFirst).toHaveBeenCalled();
    });
  });

  describe('Gap #21 — eligibility audit log', () => {
    it('writes a return_eligibility_audits row with IP + UA + counts', async () => {
      const prisma = buildPrisma({
        id: 'order-1',
        orderNumber: 'M-001',
        subOrders: [
          {
            id: 'sub-1',
            deliveredAt: new Date(),
            returnWindowEndsAt: new Date(Date.now() + 86_400_000),
            items: [
              {
                id: 'oi-1',
                productId: 'p-1',
                productTitle: 'Test',
                variantTitle: null,
                sku: null,
                imageUrl: null,
                quantity: 1,
                unitPriceInPaise: 10000n,
              },
            ],
          },
        ],
      });
      const svc = new ReturnEligibilityService(
        prisma as any,
        returnRepo,
        caseDuplicates,
        env,
      );
      await svc.checkOrderEligibility('order-1', 'cust-1', {
        ipAddress: '1.2.3.4',
        userAgent: 'JestRunner/1.0',
      });
      // Audit write happens via void Promise; flush microtasks.
      await Promise.resolve();
      expect(prisma.returnEligibilityAudit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            masterOrderId: 'order-1',
            customerId: 'cust-1',
            ipAddress: '1.2.3.4',
            userAgent: 'JestRunner/1.0',
            itemCount: 1,
          }),
        }),
      );
    });

    it('audit-write failure does NOT break eligibility response', async () => {
      const prisma = buildPrisma({
        id: 'order-1',
        orderNumber: 'M-001',
        subOrders: [],
      });
      prisma.returnEligibilityAudit.create.mockRejectedValue(
        new Error('audit table down'),
      );
      const svc = new ReturnEligibilityService(
        prisma as any,
        returnRepo,
        caseDuplicates,
        env,
      );
      const res = await svc.checkOrderEligibility('order-1', 'cust-1');
      expect(res.eligible).toBe(false);
      expect(res.reason).toMatch(/No delivered items/);
    });
  });
});
