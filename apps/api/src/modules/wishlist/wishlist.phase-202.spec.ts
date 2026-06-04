import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { WishlistService } from './wishlist.service';
import {
  ConflictAppException,
  NotFoundAppException,
} from '../../core/exceptions';

/**
 * Phase 202 — wishlist hardening spec.
 *
 * Asserts the GENUINE fixes:
 *   #2  add() applies the public product/variant gate (ACTIVE + APPROVED
 *       + not soft-deleted), not just "exists & not deleted".
 *   #3/#12 list() projects a customer-safe shape: no status columns leak,
 *       `available` is computed, price suppressed when unavailable.
 *   #6  add() enforces the per-user size cap.
 *   #8  getWishlistedIds() returns {productIds, variantPairs}.
 *   #13 add() snapshots the add-time unit price (integer paise).
 *   #7  moveToCart() re-validates, removes the row, and emits the event.
 */

type PrismaMock = {
  wishlistItem: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
  };
  product: { findUnique: jest.Mock };
  productVariant: { findUnique: jest.Mock };
};

function makePrisma(): PrismaMock {
  return {
    wishlistItem: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    product: { findUnique: jest.fn() },
    productVariant: { findUnique: jest.fn() },
  };
}

const makeEvents = () => ({ emit: jest.fn() });

const USER = 'user-1';
const PRODUCT = 'prod-1';
const VARIANT = 'var-1';

const PUBLIC_PRODUCT = {
  id: PRODUCT,
  status: 'ACTIVE',
  moderationStatus: 'APPROVED',
  isDeleted: false,
  basePrice: new Prisma.Decimal('1499.00'),
};

describe('WishlistService — Phase 202', () => {
  let prisma: PrismaMock;
  let events: ReturnType<typeof makeEvents>;
  let service: WishlistService;

  beforeEach(() => {
    prisma = makePrisma();
    events = makeEvents();
    service = new WishlistService(prisma as any, events as any);
  });

  describe('#2 add() public gate', () => {
    it('rejects a soft-deleted product as not-found', async () => {
      prisma.product.findUnique.mockResolvedValue({
        ...PUBLIC_PRODUCT,
        isDeleted: true,
      });
      await expect(service.add(USER, { productId: PRODUCT })).rejects.toThrow(
        NotFoundAppException,
      );
      expect(prisma.wishlistItem.create).not.toHaveBeenCalled();
    });

    it('rejects an un-moderated (PENDING) product', async () => {
      prisma.product.findUnique.mockResolvedValue({
        ...PUBLIC_PRODUCT,
        moderationStatus: 'PENDING',
      });
      await expect(service.add(USER, { productId: PRODUCT })).rejects.toThrow(
        NotFoundAppException,
      );
    });

    it('rejects a non-ACTIVE (SUSPENDED) product', async () => {
      prisma.product.findUnique.mockResolvedValue({
        ...PUBLIC_PRODUCT,
        status: 'SUSPENDED',
      });
      await expect(service.add(USER, { productId: PRODUCT })).rejects.toThrow(
        NotFoundAppException,
      );
    });

    it('rejects a non-ACTIVE / soft-deleted variant', async () => {
      prisma.product.findUnique.mockResolvedValue(PUBLIC_PRODUCT);
      prisma.productVariant.findUnique.mockResolvedValue({
        id: VARIANT,
        productId: PRODUCT,
        status: 'DISABLED',
        isDeleted: false,
        price: new Prisma.Decimal('1499.00'),
      });
      await expect(
        service.add(USER, { productId: PRODUCT, variantId: VARIANT }),
      ).rejects.toThrow(NotFoundAppException);
    });
  });

  describe('#6 size cap + #13 price snapshot', () => {
    it('throws Conflict when the wishlist is already at the cap', async () => {
      prisma.product.findUnique.mockResolvedValue(PUBLIC_PRODUCT);
      prisma.wishlistItem.findFirst.mockResolvedValue(null); // not a re-add
      prisma.wishlistItem.count.mockResolvedValue(200); // at MAX_WISHLIST_SIZE
      await expect(service.add(USER, { productId: PRODUCT })).rejects.toThrow(
        ConflictAppException,
      );
      expect(prisma.wishlistItem.create).not.toHaveBeenCalled();
    });

    it('snapshots the add-time unit price in integer paise (BigInt)', async () => {
      prisma.product.findUnique.mockResolvedValue(PUBLIC_PRODUCT);
      prisma.wishlistItem.findFirst.mockResolvedValue(null);
      prisma.wishlistItem.count.mockResolvedValue(3);
      prisma.wishlistItem.create.mockImplementation(async ({ data }: any) => ({
        id: 'w-1',
        ...data,
      }));

      await service.add(USER, { productId: PRODUCT });

      const arg = prisma.wishlistItem.create.mock.calls[0][0];
      // 1499.00 → 149900 paise
      expect(arg.data.unitPriceInPaiseAtAdd).toBe(149900n);
    });

    it('is idempotent — returns the existing row without counting/creating', async () => {
      prisma.product.findUnique.mockResolvedValue(PUBLIC_PRODUCT);
      prisma.wishlistItem.findFirst.mockResolvedValue({ id: 'existing' });

      const out = await service.add(USER, { productId: PRODUCT });
      expect(out).toEqual({ id: 'existing' });
      expect(prisma.wishlistItem.count).not.toHaveBeenCalled();
      expect(prisma.wishlistItem.create).not.toHaveBeenCalled();
    });
  });

  describe('#3/#12 list() customer-safe projection', () => {
    const baseRow = {
      id: 'w-1',
      productId: PRODUCT,
      variantId: null,
      note: null,
      unitPriceInPaiseAtAdd: 149900n,
      createdAt: new Date('2026-06-01T00:00:00Z'),
      product: {
        id: PRODUCT,
        title: 'Cricket Bat',
        slug: 'cricket-bat',
        basePrice: new Prisma.Decimal('1499.00'),
        status: 'ACTIVE',
        moderationStatus: 'APPROVED',
        isDeleted: false,
        brand: { id: 'b-1', name: 'NOVA' },
        images: [{ url: 'https://img/x.jpg', altText: 'bat' }],
      },
      variant: null,
    };

    it('never leaks internal status columns and computes available=true', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([baseRow]);
      prisma.wishlistItem.count.mockResolvedValue(1);

      const { items } = await service.list(USER);
      const item = items[0]!;

      expect(item.available).toBe(true);
      expect(item.priceInPaise).toBe('149900'); // string money
      expect(item.product).not.toHaveProperty('status');
      expect(item.product).not.toHaveProperty('moderationStatus');
      expect(item.product).not.toHaveProperty('isDeleted');
      expect(item.product.brand).toEqual({ id: 'b-1', name: 'NOVA' });
      expect(item.product.imageUrl).toBe('https://img/x.jpg');
      // serialized snapshot is a string
      expect(item.unitPriceInPaiseAtAdd).toBe('149900');
    });

    it('marks soft-deleted product unavailable and suppresses the price', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([
        {
          ...baseRow,
          product: { ...baseRow.product, isDeleted: true },
        },
      ]);
      prisma.wishlistItem.count.mockResolvedValue(1);

      const { items } = await service.list(USER);
      expect(items[0]!.available).toBe(false);
      expect(items[0]!.priceInPaise).toBeNull();
    });

    it('marks unapproved product unavailable', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([
        {
          ...baseRow,
          product: { ...baseRow.product, moderationStatus: 'PENDING' },
        },
      ]);
      prisma.wishlistItem.count.mockResolvedValue(1);

      const { items } = await service.list(USER);
      expect(items[0]!.available).toBe(false);
      expect(items[0]!.priceInPaise).toBeNull();
    });
  });

  describe('#8 getWishlistedIds', () => {
    it('returns deduped productIds and variant pairs', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([
        { productId: 'p1', variantId: null },
        { productId: 'p1', variantId: 'v9' },
        { productId: 'p2', variantId: null },
      ]);

      const out = await service.getWishlistedIds(USER);
      expect(out.productIds.sort()).toEqual(['p1', 'p2']);
      expect(out.variantPairs).toEqual([{ productId: 'p1', variantId: 'v9' }]);
    });
  });

  describe('#7 moveToCart', () => {
    it('removes the row and emits wishlist.moved_to_cart on success', async () => {
      prisma.wishlistItem.findUnique.mockResolvedValue({
        id: 'w-1',
        userId: USER,
        productId: PRODUCT,
        variantId: VARIANT,
      });
      prisma.product.findUnique.mockResolvedValue({
        id: PRODUCT,
        status: 'ACTIVE',
        moderationStatus: 'APPROVED',
        isDeleted: false,
      });
      prisma.productVariant.findUnique.mockResolvedValue({
        id: VARIANT,
        status: 'ACTIVE',
        isDeleted: false,
        stock: 5,
      });
      prisma.wishlistItem.delete.mockResolvedValue({});

      const out = await service.moveToCart(USER, 'w-1');

      expect(prisma.wishlistItem.delete).toHaveBeenCalledWith({
        where: { id: 'w-1' },
      });
      expect(events.emit).toHaveBeenCalledWith(
        'wishlist.moved_to_cart',
        expect.objectContaining({
          userId: USER,
          productId: PRODUCT,
          variantId: VARIANT,
          quantity: 1,
        }),
      );
      expect(out.productId).toBe(PRODUCT);
    });

    it('refuses to move an out-of-stock variant and keeps the row', async () => {
      prisma.wishlistItem.findUnique.mockResolvedValue({
        id: 'w-1',
        userId: USER,
        productId: PRODUCT,
        variantId: VARIANT,
      });
      prisma.product.findUnique.mockResolvedValue({
        id: PRODUCT,
        status: 'ACTIVE',
        moderationStatus: 'APPROVED',
        isDeleted: false,
      });
      prisma.productVariant.findUnique.mockResolvedValue({
        id: VARIANT,
        status: 'ACTIVE',
        isDeleted: false,
        stock: 0,
      });

      await expect(service.moveToCart(USER, 'w-1')).rejects.toThrow(
        ConflictAppException,
      );
      expect(prisma.wishlistItem.delete).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it("rejects another user's row as not-found", async () => {
      prisma.wishlistItem.findUnique.mockResolvedValue({
        id: 'w-1',
        userId: 'someone-else',
        productId: PRODUCT,
        variantId: null,
      });
      await expect(service.moveToCart(USER, 'w-1')).rejects.toThrow(
        NotFoundAppException,
      );
    });
  });
});
