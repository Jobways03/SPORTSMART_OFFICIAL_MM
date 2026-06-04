/**
 * Phase 197 (Checkout audit #1) — moderation gate at place-order.
 *
 * The in-tx product re-fetch validated `status === 'ACTIVE'` but NOT
 * `moderationStatus`, so a product the moderation team had UNLISTED /
 * REJECTED / left PENDING (yet still catalog-ACTIVE) could be carried
 * straight through checkout. These specs prove place-order now rejects
 * a non-APPROVED product and still accepts an APPROVED one.
 */
import { PrismaCheckoutRepository } from './prisma-checkout.repository';
import type { PlaceOrderTransactionInput } from '../../domain/repositories/checkout.repository.interface';

function makeRepo(product: any) {
  const tx = {
    product: {
      findMany: jest.fn(async () => [product]),
    },
    productVariant: { findMany: jest.fn(async () => []) },
    customerTaxProfile: { findUnique: jest.fn(async () => null) },
    masterOrder: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'mo-1',
        orderNumber: data.orderNumber,
        customerId: data.customerId,
        totalAmount: data.totalAmount,
        itemCount: data.itemCount,
      })),
      update: jest.fn(async () => ({})),
    },
    subOrder: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'so-1',
        masterOrderId: data.masterOrderId,
      })),
    },
    orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    orderItemTaxConfigSnapshot: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    cart: { findUnique: jest.fn(async () => null) },
    cartItem: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    referralAttribution: { create: jest.fn() },
    $queryRaw: jest.fn(async () => [{ nextval: BigInt(7) }]),
  };
  const prisma: any = {
    masterOrder: { findUnique: jest.fn(async () => null) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const moneyDualWrite: any = {
    applyPaise: (_k: string, data: any) => ({
      ...data,
      totalAmountInPaise: BigInt(Math.round(Number(data.totalAmount) * 100)),
      discountAmountInPaise: BigInt(Math.round(Number(data.discountAmount ?? 0) * 100)),
    }),
  };
  return { repo: new PrismaCheckoutRepository(prisma as any, moneyDualWrite), tx };
}

function baseInput(): PlaceOrderTransactionInput {
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
  } as PlaceOrderTransactionInput;
}

describe('placeOrderTransaction moderation gate (Phase 197 #1)', () => {
  it.each(['PENDING', 'REJECTED', 'UNLISTED', null, undefined])(
    'rejects a product with moderationStatus=%s',
    async (mod) => {
      const { repo } = makeRepo({
        id: 'p-1',
        basePrice: '100.00',
        status: 'ACTIVE',
        moderationStatus: mod,
      });
      await expect(repo.placeOrderTransaction(baseInput())).rejects.toThrow(
        /not available for purchase/i,
      );
    },
  );

  it('accepts an APPROVED + ACTIVE product', async () => {
    const { repo } = makeRepo({
      id: 'p-1',
      basePrice: '100.00',
      status: 'ACTIVE',
      moderationStatus: 'APPROVED',
    });
    const out = await repo.placeOrderTransaction(baseInput());
    expect(out.masterOrderId).toBe('mo-1');
  });

  it('still rejects an inactive product before the moderation check', async () => {
    const { repo } = makeRepo({
      id: 'p-1',
      basePrice: '100.00',
      status: 'INACTIVE',
      moderationStatus: 'APPROVED',
    });
    await expect(repo.placeOrderTransaction(baseInput())).rejects.toThrow(
      /no longer available/i,
    );
  });
});
