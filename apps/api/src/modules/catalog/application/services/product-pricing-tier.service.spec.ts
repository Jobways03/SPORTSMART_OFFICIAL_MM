import { ProductPricingTierService } from './product-pricing-tier.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

/**
 * Story 3.5 — pricing tier service. Tests the validation contract:
 * percent in [0, 100], minQty positive integer, variantId must belong
 * to the product, P2002 → 400 with the "update existing" hint.
 *
 * Cart-time application is explicitly out of scope at v1, so there
 * are no tests for cart price mutation — there's no code path to test.
 */
describe('ProductPricingTierService', () => {
  function buildService(prismaOverrides: Record<string, any> = {}) {
    const prisma: any = {
      product: {
        count: jest.fn().mockResolvedValue(1),
      },
      productVariant: {
        count: jest.fn().mockResolvedValue(1),
      },
      productPricingTier: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'tier-1',
          productId: 'p-1',
          variantId: null,
          minQuantity: 5,
          discountPercent: 10,
          displayLabel: null,
          isActive: true,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        }),
        update: jest.fn(),
        delete: jest.fn(),
      },
      ...prismaOverrides,
    };
    return { service: new ProductPricingTierService(prisma), prisma };
  }

  describe('create', () => {
    it('rejects discountPercent < 0', async () => {
      const { service } = buildService();
      await expect(
        service.create('p-1', { minQuantity: 5, discountPercent: -1 }),
      ).rejects.toBeInstanceOf(BadRequestAppException);
    });

    it('rejects discountPercent > 100', async () => {
      const { service } = buildService();
      await expect(
        service.create('p-1', { minQuantity: 5, discountPercent: 101 }),
      ).rejects.toBeInstanceOf(BadRequestAppException);
    });

    it('rejects non-integer minQuantity', async () => {
      const { service } = buildService();
      await expect(
        service.create('p-1', { minQuantity: 1.5, discountPercent: 10 }),
      ).rejects.toBeInstanceOf(BadRequestAppException);
    });

    it('rejects zero / negative minQuantity', async () => {
      const { service } = buildService();
      await expect(
        service.create('p-1', { minQuantity: 0, discountPercent: 10 }),
      ).rejects.toBeInstanceOf(BadRequestAppException);
      await expect(
        service.create('p-1', { minQuantity: -1, discountPercent: 10 }),
      ).rejects.toBeInstanceOf(BadRequestAppException);
    });

    it('rejects insanely large minQuantity', async () => {
      const { service } = buildService();
      await expect(
        service.create('p-1', { minQuantity: 200_000, discountPercent: 10 }),
      ).rejects.toBeInstanceOf(BadRequestAppException);
    });

    it('404 when product not found', async () => {
      const { service } = buildService({
        product: { count: jest.fn().mockResolvedValue(0) },
      });
      await expect(
        service.create('p-1', { minQuantity: 5, discountPercent: 10 }),
      ).rejects.toBeInstanceOf(NotFoundAppException);
    });

    it('400 when variantId belongs to a different product', async () => {
      const { service } = buildService({
        productVariant: { count: jest.fn().mockResolvedValue(0) },
      });
      await expect(
        service.create('p-1', {
          variantId: 'v-other',
          minQuantity: 5,
          discountPercent: 10,
        }),
      ).rejects.toBeInstanceOf(BadRequestAppException);
    });

    it('translates P2002 (duplicate minQty) into a friendly 400', async () => {
      const { service } = buildService({
        productPricingTier: {
          create: jest.fn().mockRejectedValue({ code: 'P2002' }),
        },
      });
      await expect(
        service.create('p-1', { minQuantity: 5, discountPercent: 10 }),
      ).rejects.toBeInstanceOf(BadRequestAppException);
    });

    it('happy path: returns formatted response with derived displayLabel', async () => {
      const { service } = buildService();
      const result = await service.create('p-1', {
        minQuantity: 5,
        discountPercent: 10,
      });
      expect(result.id).toBe('tier-1');
      expect(result.discountPercent).toBe(10);
      // Default label format when ops didn't override.
      expect(result.displayLabel).toBe('Buy 5+ save 10%');
    });
  });

  describe('listActiveForProduct', () => {
    it('404 when product not found', async () => {
      const { service } = buildService({
        product: { count: jest.fn().mockResolvedValue(0) },
      });
      await expect(
        service.listActiveForProduct({ productId: 'missing' }),
      ).rejects.toBeInstanceOf(NotFoundAppException);
    });

    it('formats decimal discountPercent as a number', async () => {
      const { service } = buildService({
        productPricingTier: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 't-1',
              productId: 'p-1',
              variantId: null,
              minQuantity: 5,
              discountPercent: '10.50',
              displayLabel: null,
              isActive: true,
              createdAt: new Date('2026-01-01'),
              updatedAt: new Date('2026-01-01'),
            },
          ]),
        },
      });
      const rows = await service.listActiveForProduct({ productId: 'p-1' });
      expect(rows[0]!.discountPercent).toBe(10.5);
      expect(rows[0]!.displayLabel).toBe('Buy 5+ save 10.5%');
    });
  });

  describe('remove', () => {
    it('404 on missing tier (P2025)', async () => {
      const { service } = buildService({
        productPricingTier: {
          delete: jest.fn().mockRejectedValue({ code: 'P2025' }),
        },
      });
      await expect(service.remove('missing')).rejects.toBeInstanceOf(
        NotFoundAppException,
      );
    });
  });
});
