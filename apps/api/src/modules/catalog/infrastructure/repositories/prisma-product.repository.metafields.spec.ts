/**
 * 2026-06-12 — regression lock for the seller edit-page metafield bug.
 *
 * The seller product edit form (Phase 39 CategoryMetafieldFormSection)
 * hydrates its "Category fields" from `product.metafields[]` on
 * GET /seller/products/:id. findByIdForSeller shipped WITHOUT the
 * metafields include, so the form silently rendered every metafield
 * as empty even though values were persisted in product_metafields.
 * This spec pins the include so it can't be dropped again.
 */
import { PrismaProductRepository } from './prisma-product.repository';

describe('PrismaProductRepository.findByIdForSeller — metafield hydration', () => {
  it('includes metafields with their definitions (seller edit form reads them)', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const repo = new PrismaProductRepository({ product: { findFirst } } as any);

    await repo.findByIdForSeller('p-1', 's-1');

    expect(findFirst).toHaveBeenCalledTimes(1);
    const arg = findFirst.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: 'p-1', sellerId: 's-1', isDeleted: false });
    expect(arg.include.metafields).toEqual({
      include: { metafieldDefinition: true },
    });
  });
});
