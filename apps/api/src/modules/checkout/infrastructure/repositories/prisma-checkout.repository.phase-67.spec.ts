// Phase 67 (2026-05-22) — order-placement hardening regression
// coverage for the in-tx changes:
//   Gap #3  — idempotencyKey fast-path + DB-conflict marker
//   Gap #6/#22 — acceptDeadlineAt populated at sub-order create
//   Gap #12 — paise-level price tolerance
//   Gap #19 — variant status gate
//   Gap #20 — tax profile ownership re-check inside tx
//   Gap #9  — sourceCartId persisted at create

import { PrismaCheckoutRepository } from './prisma-checkout.repository';
import type {
  PlaceOrderTransactionInput,
} from '../../domain/repositories/checkout.repository.interface';

const PRICE_TOLERANCE_NOTE = 'paise compare allows ±1 paise drift';

function makeRepo(opts: {
  product?: any;
  variant?: any | null;
  customerTaxProfile?: any;
  conflictOnCreate?: boolean;
  cart?: any;
  subOrderId?: string;
  masterOrderId?: string;
  existingForKey?: any;
}) {
  const create = jest.fn(async ({ data }) => {
    if (opts.conflictOnCreate) {
      const e = new Error('Unique constraint failed');
      (e as any).code = 'P2002';
      throw e;
    }
    return {
      id: opts.masterOrderId ?? 'mo-1',
      orderNumber: data.orderNumber,
      customerId: data.customerId,
      totalAmount: data.totalAmount,
      itemCount: data.itemCount,
    };
  });
  const subOrderCreate = jest.fn(async ({ data }) => ({
    id: opts.subOrderId ?? 'so-1',
    masterOrderId: data.masterOrderId,
    acceptDeadlineAt: data.acceptDeadlineAt,
    commissionRateSnapshot: data.commissionRateSnapshot,
  }));
  const cartFindUnique = jest.fn(async () => opts.cart ?? null);
  const cartItemDeleteMany = jest.fn(async () => ({ count: 0 }));
  const productFindMany = jest.fn(async () =>
    opts.product === undefined
      ? []
      : // Phase 197 (Checkout audit #1) — the in-tx product re-fetch now
        // also reads moderationStatus and rejects anything not APPROVED.
        // These Phase-67 fixtures predate that gate, so default to
        // APPROVED unless a test deliberately overrides it.
        [{ moderationStatus: 'APPROVED', ...opts.product }],
  );
  const variantFindMany = jest.fn(async () =>
    'variant' in opts ? (opts.variant ? [opts.variant] : []) : [],
  );
  const customerTaxProfileFindUnique = jest.fn(async () => opts.customerTaxProfile ?? null);
  const orderSequenceUpsert = jest.fn(async () => ({ id: 1, lastNumber: 7 }));
  const masterOrderUpdate = jest.fn(async () => ({}));
  const masterOrderFindUnique = jest.fn(async () => opts.existingForKey ?? null);

  const tx = {
    product: { findMany: productFindMany },
    productVariant: { findMany: variantFindMany },
    customerTaxProfile: { findUnique: customerTaxProfileFindUnique },
    orderSequence: { upsert: orderSequenceUpsert },
    masterOrder: { create, update: masterOrderUpdate },
    subOrder: { create: subOrderCreate },
    // Phase 70 (audit Gap #15) — repo now selects OrderItem ids
    // after sub-order create to write the tax-config snapshot
    // rows. Default mock: no items found means the snapshot
    // createMany path early-exits (length-0 guard).
    orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    orderItemTaxConfigSnapshot: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    cart: { findUnique: cartFindUnique },
    cartItem: { deleteMany: cartItemDeleteMany },
    referralAttribution: { create: jest.fn() },
    affiliateCouponCode: { update: jest.fn() },
    // Phase 69 (2026-05-22) — Phase 67 audit Gap #17/#18. The repo
    // now reads `SELECT nextval('order_number_seq')` instead of
    // upserting the legacy order_sequence row. Mock returns a
    // sequence value that fills the same slot the upsert mock did.
    $queryRaw: jest.fn(async () => [{ nextval: BigInt(7) }]),
  };
  const prisma: any = {
    masterOrder: {
      findUnique: masterOrderFindUnique,
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const moneyDualWrite: any = {
    applyPaise: (_kind: string, data: any) => ({
      ...data,
      totalAmountInPaise: BigInt(Math.round(Number(data.totalAmount) * 100)),
      discountAmountInPaise: BigInt(Math.round(Number(data.discountAmount ?? 0) * 100)),
    }),
  };
  const repo = new PrismaCheckoutRepository(prisma as any, moneyDualWrite);
  return {
    repo,
    prisma,
    tx,
    masterOrderCreate: create,
    subOrderCreate,
    cartItemDeleteMany,
    customerTaxProfileFindUnique,
    masterOrderFindUnique,
    masterOrderUpdate,
  };
}

function baseInput(over: Partial<PlaceOrderTransactionInput> = {}): PlaceOrderTransactionInput {
  return {
    customerId: 'c-1',
    addressSnapshot: { city: 'Hyderabad', postalCode: '500001' },
    totalAmount: 100,
    itemCount: 1,
    paymentMethod: 'COD',
    fulfillmentGroups: {
      'SELLER:s-1': {
        nodeName: 'Shop A',
        nodeType: 'SELLER',
        nodeId: 's-1',
        items: [
          {
            productId: 'p-1',
            variantId: null,
            productTitle: 'Shoe',
            variantTitle: null,
            sku: 'SKU-1',
            masterSku: 'MS-1',
            imageUrl: 'https://cdn/x.jpg',
            unitPrice: 100,
            quantity: 1,
            totalPrice: 100,
          },
        ],
      },
    },
    discountCode: null,
    discountAmount: 0,
    ...over,
  };
}

describe('PrismaCheckoutRepository.placeOrderTransaction (Phase 67)', () => {
  it('Gap #3 — fast-path: returns existing order when idempotencyKey already in DB', async () => {
    const { repo, prisma, masterOrderCreate } = makeRepo({
      existingForKey: {
        id: 'mo-existing',
        orderNumber: 'SM20260001',
        totalAmount: 250,
        itemCount: 2,
        subOrders: [
          { id: 'so-x', sellerId: 's-1', franchiseId: null, fulfillmentNodeType: 'SELLER', subTotal: 250, items: [{ quantity: 1 }, { quantity: 1 }] },
        ],
      },
    });
    const out = await repo.placeOrderTransaction(baseInput({ idempotencyKey: 'KEY-A' }));
    expect(out.masterOrderId).toBe('mo-existing');
    expect(out.reusedExistingOrder).toBe(true);
    // No new tx opened, no master order created.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(masterOrderCreate).not.toHaveBeenCalled();
  });

  it('Gap #3 — tx path: maps P2002 on idempotencyKey to IDEMPOTENCY_CONFLICT marker', async () => {
    const { repo } = makeRepo({
      product: { id: 'p-1', basePrice: '100.00', status: 'ACTIVE' },
      conflictOnCreate: true,
    });
    await expect(
      repo.placeOrderTransaction(baseInput({ idempotencyKey: 'KEY-B' })),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      idempotencyKey: 'KEY-B',
    });
  });

  it('Gap #19 — rejects inactive variant', async () => {
    const { repo } = makeRepo({
      product: { id: 'p-1', basePrice: '100.00', status: 'ACTIVE' },
      variant: { id: 'v-1', price: '100.00', status: 'INACTIVE' },
    });
    await expect(
      repo.placeOrderTransaction(
        baseInput({
          fulfillmentGroups: {
            'SELLER:s-1': {
              nodeName: 'Shop A',
              nodeType: 'SELLER',
              nodeId: 's-1',
              items: [
                {
                  productId: 'p-1',
                  variantId: 'v-1',
                  productTitle: 'Shoe',
                  variantTitle: 'Red',
                  sku: 'SKU-1',
                  masterSku: 'MS-1',
                  imageUrl: null,
                  unitPrice: 100,
                  quantity: 1,
                  totalPrice: 100,
                },
              ],
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('no longer available') });
  });

  it(`Gap #12 — ${PRICE_TOLERANCE_NOTE}; rejects 2-paise drift up`, async () => {
    const { repo } = makeRepo({
      product: { id: 'p-1', basePrice: '100.00', status: 'ACTIVE' },
    });
    // session item price 100.02 vs canonical 100.00 → 2 paise > 1 paise tolerance → reject
    await expect(
      repo.placeOrderTransaction(
        baseInput({
          fulfillmentGroups: {
            'SELLER:s-1': {
              nodeName: 'Shop A',
              nodeType: 'SELLER',
              nodeId: 's-1',
              items: [
                {
                  productId: 'p-1',
                  variantId: null,
                  productTitle: 'Shoe',
                  variantTitle: null,
                  sku: 'SKU-1',
                  masterSku: 'MS-1',
                  imageUrl: null,
                  unitPrice: 100.02,
                  quantity: 1,
                  totalPrice: 100.02,
                  appliedListUnitPrice: 100.02,
                },
              ],
            },
          },
        }),
      ),
    // Phase 197 (#21) — drift error is now a generic customer-facing message
    // (exact was/now figures are logged server-side only).
    ).rejects.toMatchObject({ message: expect.stringContaining('prices in your cart have changed') });
  });

  it('Gap #20 — rejects tax profile owned by another customer (re-checked inside tx)', async () => {
    const { repo } = makeRepo({
      product: { id: 'p-1', basePrice: '100.00', status: 'ACTIVE' },
      customerTaxProfile: { customerId: 'someone-else' },
    });
    await expect(
      repo.placeOrderTransaction(
        baseInput({ selectedTaxProfileId: 'tp-foreign' }),
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('does not belong to this customer'),
    });
  });

  it('Gap #6/#22 — sub-order created with 24h acceptDeadlineAt by default', async () => {
    const { repo, subOrderCreate } = makeRepo({
      product: { id: 'p-1', basePrice: '100.00', status: 'ACTIVE' },
    });
    const before = Date.now();
    await repo.placeOrderTransaction(baseInput());
    const after = Date.now();
    const dataArg = (subOrderCreate.mock.calls[0] as any)[0].data;
    expect(dataArg.acceptDeadlineAt).toBeInstanceOf(Date);
    const stampMs = (dataArg.acceptDeadlineAt as Date).getTime();
    // 24h ± 5s wall-clock tolerance.
    expect(stampMs).toBeGreaterThanOrEqual(before + 24 * 3600 * 1000 - 5000);
    expect(stampMs).toBeLessThanOrEqual(after + 24 * 3600 * 1000 + 5000);
  });

  it('Gap #6/#22 — group acceptSlaHours overrides the default', async () => {
    const { repo, subOrderCreate } = makeRepo({
      product: { id: 'p-1', basePrice: '100.00', status: 'ACTIVE' },
    });
    await repo.placeOrderTransaction(
      baseInput({
        fulfillmentGroups: {
          'SELLER:s-1': {
            nodeName: 'Shop A',
            nodeType: 'SELLER',
            nodeId: 's-1',
            acceptSlaHours: 6,
            items: [
              {
                productId: 'p-1',
                variantId: null,
                productTitle: 'Shoe',
                variantTitle: null,
                sku: 'SKU-1',
                masterSku: 'MS-1',
                imageUrl: null,
                unitPrice: 100,
                quantity: 1,
                totalPrice: 100,
              },
            ],
          },
        },
      }),
    );
    const dataArg = (subOrderCreate.mock.calls[0] as any)[0].data;
    const sla = (dataArg.acceptDeadlineAt as Date).getTime() - Date.now();
    expect(sla).toBeGreaterThan(5.5 * 3600 * 1000);
    expect(sla).toBeLessThan(6.5 * 3600 * 1000);
  });

  it('Gap #9 — persists sourceCartId when supplied', async () => {
    const { repo, masterOrderCreate } = makeRepo({
      product: { id: 'p-1', basePrice: '100.00', status: 'ACTIVE' },
    });
    await repo.placeOrderTransaction(
      baseInput({ sourceCartId: 'cart-abc' }),
    );
    expect(masterOrderCreate).toHaveBeenCalled();
    const dataArg = (masterOrderCreate.mock.calls[0] as any)[0].data;
    expect(dataArg.sourceCartId).toBe('cart-abc');
  });

  it('returns reusedExistingOrder=false for a fresh placement', async () => {
    const { repo } = makeRepo({
      product: { id: 'p-1', basePrice: '100.00', status: 'ACTIVE' },
    });
    const out = await repo.placeOrderTransaction(baseInput());
    expect(out.reusedExistingOrder).toBe(false);
    // Phase 197 (#3) — sequence pad widened 4→7 digits (SM<year><7-pad>).
    expect(out.orderNumber).toMatch(/^SM\d{4}0000007$/);
  });
});

describe('PrismaCheckoutRepository.linkStockReservationsToOrderItems', () => {
  it('no-ops on empty map', async () => {
    const repo = new PrismaCheckoutRepository(
      { $transaction: jest.fn() } as any,
      { applyPaise: (_: string, x: any) => x } as any,
    );
    await repo.linkStockReservationsToOrderItems('mo-1', {});
    // No transaction opened.
    expect((repo as any).prisma.$transaction).not.toHaveBeenCalled();
  });

  it('issues an updateMany per entry within a single tx', async () => {
    const updateMany = jest.fn();
    const prisma: any = {
      orderItem: { updateMany },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const repo = new PrismaCheckoutRepository(prisma, { applyPaise: (_: string, x: any) => x } as any);
    await repo.linkStockReservationsToOrderItems('mo-1', {
      'oi-1': 'res-a',
      'oi-2': 'res-b',
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'oi-1', subOrder: { masterOrderId: 'mo-1' } },
      data: { stockReservationId: 'res-a' },
    });
  });
});

describe('PrismaCheckoutRepository.markOrderFinalized', () => {
  it('only flips rows where finalizedAt IS NULL', async () => {
    const updateMany = jest.fn();
    const prisma: any = {
      masterOrder: { updateMany },
    };
    const repo = new PrismaCheckoutRepository(prisma, { applyPaise: (_: string, x: any) => x } as any);
    await repo.markOrderFinalized('mo-1');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'mo-1', finalizedAt: null },
      data: { finalizedAt: expect.any(Date) },
    });
  });
});

describe('PrismaCheckoutRepository.findOrderByIdempotencyKey', () => {
  it('returns null when not found', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma: any = { masterOrder: { findUnique } };
    const repo = new PrismaCheckoutRepository(prisma, { applyPaise: (_: string, x: any) => x } as any);
    const out = await repo.findOrderByIdempotencyKey('KEY-X');
    expect(out).toBeNull();
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { idempotencyKey: 'KEY-X' },
    }));
  });

  it('returns reusedExistingOrder=true when row exists', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'mo-y',
      orderNumber: 'SM20260042',
      totalAmount: 500,
      itemCount: 3,
      subOrders: [
        { id: 'so-1', sellerId: 's-1', franchiseId: null, fulfillmentNodeType: 'SELLER', subTotal: 500, items: [{ quantity: 1 }, { quantity: 1 }, { quantity: 1 }] },
      ],
    });
    const prisma: any = { masterOrder: { findUnique } };
    const repo = new PrismaCheckoutRepository(prisma, { applyPaise: (_: string, x: any) => x } as any);
    const out = await repo.findOrderByIdempotencyKey('KEY-Y');
    expect(out).not.toBeNull();
    expect(out!.reusedExistingOrder).toBe(true);
    expect(out!.orderNumber).toBe('SM20260042');
    expect(out!.itemCount).toBe(3);
  });
});
