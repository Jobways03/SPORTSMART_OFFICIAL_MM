/**
 * Phase 197 (My-Orders audit #1/#2/#10/#16) — customer order response
 * PII whitelist.
 *
 * Pre-Phase-197 listCustomerOrders + getCustomerOrder spread the full
 * MasterOrder row (`...o` / `...order`) to the buyer, leaking internal
 * fraud + payment columns (verificationRiskScore/Band/Reasons,
 * claimedByAdminId, verifiedBy, razorpayOrderId/razorpayPaymentId,
 * paymentExpiresAt, sourceCartSnapshot, …). These specs assert the
 * response now exposes ONLY the customer-safe whitelist, that the
 * sub-order/item shapes are locked, that the detail path embeds
 * order-scoped returns (#10), and that paymentExpiresAt is surfaced on
 * detail only (#16).
 */
import { OrdersService } from './orders.service';

// A MasterOrder row as the repo include returns it — packed with the
// sensitive columns the old spread leaked.
function sensitiveMasterRow(overrides: Partial<any> = {}): any {
  return {
    id: 'mo-1',
    orderNumber: 'SM20260000001',
    customerId: 'cust-1',
    orderStatus: 'PLACED',
    paymentStatus: 'PENDING',
    paymentMethod: 'COD',
    totalAmount: 1999.0,
    totalAmountInPaise: 199900n,
    currency: 'INR',
    itemCount: 1,
    discountCode: null,
    discountAmount: 0,
    discountAmountInPaise: 0n,
    shippingOptionName: null,
    shippingFeeInPaise: 0n,
    shippingAddressSnapshot: { fullName: 'A B', phone: '9876543210' },
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T01:00:00Z'),
    // ── sensitive / internal — MUST NOT leak ──
    verificationRiskScore: 87,
    verificationRiskBand: 'RED',
    verificationRiskReasons: [{ rule: 'velocity', weight: 40 }],
    verificationRemarks: 'flagged by ops',
    verifiedBy: 'admin-9',
    claimedByAdminId: 'admin-9',
    claimedAt: new Date(),
    claimExpiresAt: new Date(),
    selectedTaxProfileId: 'profile-1',
    razorpayOrderId: 'order_SECRET',
    razorpayPaymentId: 'pay_SECRET',
    paymentExpiresAt: new Date('2026-06-01T00:30:00Z'),
    lastFailedPaymentId: 'pay_FAIL',
    lastPaymentFailureReason: 'card declined',
    sourceCartSnapshot: { items: [] },
    idempotencyKey: 'idem-secret',
    finalizedAt: new Date(),
    gstModeSnapshot: 'STRICT',
    subOrders: [
      {
        id: 'so-1',
        sellerId: 'seller-7', // MUST NOT leak
        franchiseId: null,
        subTotal: 1999.0,
        paymentStatus: 'PENDING',
        fulfillmentStatus: 'UNFULFILLED',
        acceptStatus: 'OPEN',
        deliveredAt: null,
        acceptDeadlineAt: new Date(),
        lastTrackingEventAt: null,
        returnWindowEndsAt: null,
        commissionRateSnapshot: 12.5, // MUST NOT leak
        commissionProcessed: false, // MUST NOT leak
        commissionDecision: 'PENDING', // MUST NOT leak
        rejectionReason: 'n/a', // MUST NOT leak
        deliveryMethod: 'SELF_DELIVERY',
        selfDeliveryStatus: 'PENDING',
        items: [
          {
            id: 'oi-1',
            productId: 'p-1',
            variantId: null,
            productTitle: 'Football',
            variantTitle: null,
            sku: 'FB-1',
            masterSku: 'M-FB-1', // not in customer shape
            imageUrl: 'http://img/1.jpg',
            imagePublicId: 'cloud/abc', // not in customer shape
            unitPrice: 1999.0,
            quantity: 1,
            totalPrice: 1999.0,
            unitPriceInPaise: 199900n, // not in customer shape
            appliedListUnitPrice: 2200.0, // MUST NOT leak
            appliedPricingTierId: 'tier-1', // MUST NOT leak
            stockReservationId: 'res-1', // MUST NOT leak
          },
        ],
      },
    ],
    ...overrides,
  };
}

const SENSITIVE_MASTER_KEYS = [
  'verificationRiskScore',
  'verificationRiskBand',
  'verificationRiskReasons',
  'verificationRemarks',
  'verifiedBy',
  'claimedByAdminId',
  'claimedAt',
  'claimExpiresAt',
  'selectedTaxProfileId',
  'razorpayOrderId',
  'razorpayPaymentId',
  'lastFailedPaymentId',
  'lastPaymentFailureReason',
  'sourceCartSnapshot',
  'idempotencyKey',
  'finalizedAt',
  'gstModeSnapshot',
  'customerId',
];

const SENSITIVE_SUB_KEYS = [
  'sellerId',
  'franchiseId',
  'commissionRateSnapshot',
  'commissionProcessed',
  'commissionDecision',
  'rejectionReason',
];

const SENSITIVE_ITEM_KEYS = [
  'masterSku',
  'imagePublicId',
  'unitPriceInPaise',
  'appliedListUnitPrice',
  'appliedPricingTierId',
  'stockReservationId',
];

function makeService(repoOverrides: any = {}, prismaOverrides: any = {}) {
  const orderRepo: any = {
    findCustomerOrders: jest.fn().mockResolvedValue([sensitiveMasterRow()]),
    countCustomerOrders: jest.fn().mockResolvedValue(1),
    countCustomerOrdersByBucket: jest
      .fn()
      .mockResolvedValue({ all: 1, active: 1, delivered: 0, cancelled: 0 }),
    findMasterOrderByCustomer: jest
      .fn()
      .mockResolvedValue(sensitiveMasterRow()),
    ...repoOverrides,
  };

  const prisma: any = {
    orderItemTaxSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    discountRedemption: { findFirst: jest.fn().mockResolvedValue(null) },
    return: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'ret-1',
          returnNumber: 'RET-2026-000001',
          status: 'REQUESTED',
          createdAt: new Date('2026-06-01T02:00:00Z'),
        },
      ]),
    },
    ...prismaOverrides,
  };

  const svc = new OrdersService(
    orderRepo,
    { publish: jest.fn() } as any,
    {} as any,
    { reserveStock: jest.fn(), unreserveStock: jest.fn() } as any,
    prisma,
    {} as any,
    { getNumber: (_: string, d: number) => d } as any,
    {} as any,
  );
  return { svc, orderRepo, prisma };
}

describe('OrdersService customer PII whitelist (Phase 197)', () => {
  describe('listCustomerOrders (#1/#2)', () => {
    it('excludes every sensitive MasterOrder column', async () => {
      const { svc } = makeService();
      const res = await svc.listCustomerOrders('cust-1', 1, 20);
      const order = res.orders[0] as any;
      for (const key of SENSITIVE_MASTER_KEYS) {
        expect(order).not.toHaveProperty(key);
      }
    });

    it('excludes sensitive sub-order + item columns', async () => {
      const { svc } = makeService();
      const res = await svc.listCustomerOrders('cust-1', 1, 20);
      const sub = (res.orders[0] as any).subOrders[0];
      for (const key of SENSITIVE_SUB_KEYS) {
        expect(sub).not.toHaveProperty(key);
      }
      const item = sub.items[0];
      for (const key of SENSITIVE_ITEM_KEYS) {
        expect(item).not.toHaveProperty(key);
      }
    });

    it('still returns the customer-safe fields', async () => {
      const { svc } = makeService();
      const res = await svc.listCustomerOrders('cust-1', 1, 20);
      const order = res.orders[0] as any;
      expect(order.orderNumber).toBe('SM20260000001');
      expect(order.totalAmount).toBe(1999.0);
      expect(order.shippingAddressSnapshot).toBeDefined();
      expect(order.subOrders[0].fulfilledBy).toBe('SPORTSMART');
    });

    it('does NOT surface paymentExpiresAt on the listing (#16 = detail only)', async () => {
      const { svc } = makeService();
      const res = await svc.listCustomerOrders('cust-1', 1, 20);
      expect((res.orders[0] as any)).not.toHaveProperty('paymentExpiresAt');
    });

    it('returns server-side per-bucket counts (#7)', async () => {
      const { svc } = makeService();
      const res = await svc.listCustomerOrders('cust-1', 1, 20, 'active');
      expect(res.pagination.status).toBe('active');
      expect(res.pagination.counts).toEqual({
        all: 1,
        active: 1,
        delivered: 0,
        cancelled: 0,
      });
    });
  });

  describe('getCustomerOrder (#1/#10/#16)', () => {
    it('excludes every sensitive MasterOrder column', async () => {
      const { svc } = makeService();
      const order = (await svc.getCustomerOrder('cust-1', 'SM20260000001')) as any;
      for (const key of SENSITIVE_MASTER_KEYS) {
        // paymentExpiresAt is intentionally surfaced on detail; all
        // OTHER sensitive keys must be gone.
        expect(order).not.toHaveProperty(key);
      }
    });

    it('surfaces paymentExpiresAt on detail (#16)', async () => {
      const { svc } = makeService();
      const order = (await svc.getCustomerOrder('cust-1', 'SM20260000001')) as any;
      expect(order).toHaveProperty('paymentExpiresAt');
    });

    it('embeds order-scoped returns (#10)', async () => {
      const { svc, prisma } = makeService();
      const order = (await svc.getCustomerOrder('cust-1', 'SM20260000001')) as any;
      expect(prisma.return.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { masterOrderId: 'mo-1' } }),
      );
      expect(order.returns).toHaveLength(1);
      expect(order.returns[0].returnNumber).toBe('RET-2026-000001');
    });

    it('locks the sub-order + item shape on detail too', async () => {
      const { svc } = makeService();
      const order = (await svc.getCustomerOrder('cust-1', 'SM20260000001')) as any;
      const sub = order.subOrders[0];
      for (const key of SENSITIVE_SUB_KEYS) {
        expect(sub).not.toHaveProperty(key);
      }
      for (const key of SENSITIVE_ITEM_KEYS) {
        expect(sub.items[0]).not.toHaveProperty(key);
      }
    });
  });
});
