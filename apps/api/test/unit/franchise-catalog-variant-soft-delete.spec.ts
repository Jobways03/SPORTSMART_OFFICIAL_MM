import 'reflect-metadata';
import { PrismaFranchiseCatalogRepository } from '../../src/modules/franchise/infrastructure/repositories/prisma-franchise-catalog.repository';

/**
 * Regression test for the soft-deleted-variant leak in the franchise
 * catalog repo.
 *
 * Before: every catalog mapping lookup (findByFranchiseId,
 * findAllPaginated, findByFranchiseAndProduct) would happily return a
 * mapping whose underlying ProductVariant had been soft-deleted by the
 * seller. The mapping row still existed, the FK hadn't been SetNull'd,
 * and nothing in the query path filtered on `variant.isDeleted`. Knock-
 * on effects:
 *   - POS validation: a tombstoned SKU could be scanned and sold, since
 *     findByFranchiseAndProduct returned a live-looking mapping.
 *   - Allocation: the online-order routing engine could reserve stock
 *     on a dead variant.
 *   - UI: the franchise catalog list rendered dead SKUs.
 *
 * After: list lookups compose an `AND` clause that excludes mappings
 * with a soft-deleted variant (while keeping product-level mappings
 * where variantId is null). The by-(franchise,product,variant) lookup
 * — the critical path for POS — also applies the filter.
 */

describe('PrismaFranchiseCatalogRepository — soft-deleted variant filter', () => {
  const buildRepo = () => {
    const captured: { findMany?: any; findFirst?: any } = {};
    const prisma: any = {
      franchiseCatalogMapping: {
        findMany: jest.fn(async (args: any) => {
          captured.findMany = args;
          return [];
        }),
        count: jest.fn(async () => 0),
        findFirst: jest.fn(async (args: any) => {
          captured.findFirst = args;
          return null;
        }),
      },
      $transaction: (ops: any[]) => Promise.all(ops),
    };
    const repo = new PrismaFranchiseCatalogRepository(prisma);
    return { repo, prisma, captured };
  };

  describe('findByFranchiseId (franchise-side list)', () => {
    it('excludes mappings whose variant is soft-deleted, keeps variantId=null rows', async () => {
      const { repo, captured } = buildRepo();
      await repo.findByFranchiseId('fr-1', { page: 1, limit: 20 });

      const where = captured.findMany.where;
      expect(where.franchiseId).toBe('fr-1');
      expect(where.product).toEqual({ isDeleted: false });

      // The AND array must contain an OR that allows variantId=null
      // OR requires variant.isDeleted=false. Without this, dead-variant
      // mappings leak into the list view.
      expect(where.AND).toEqual(
        expect.arrayContaining([
          {
            OR: [
              { variantId: null },
              { variant: { isDeleted: false } },
            ],
          },
        ]),
      );
    });

    it('search term is added as a separate AND clause, not a top-level OR that clobbers the variant filter', async () => {
      const { repo, captured } = buildRepo();
      await repo.findByFranchiseId('fr-1', { page: 1, limit: 20, search: 'shoe' });

      const where = captured.findMany.where;
      // Expect at least two AND clauses: variant filter + search OR.
      expect(where.AND).toHaveLength(2);
      // The variant filter must still be there.
      expect(where.AND[0]).toEqual({
        OR: [{ variantId: null }, { variant: { isDeleted: false } }],
      });
      // The second clause is the search OR; verify it carries the
      // search term so we know the original search behavior still works.
      const searchClause = where.AND[1];
      expect(searchClause.OR).toEqual(
        expect.arrayContaining([
          { globalSku: { contains: 'shoe', mode: 'insensitive' } },
        ]),
      );
    });
  });

  describe('findAllPaginated (admin-wide list)', () => {
    it('applies the same variant soft-delete filter', async () => {
      const { repo, captured } = buildRepo();
      await repo.findAllPaginated({ page: 1, limit: 20 });

      const where = captured.findMany.where;
      expect(where.AND).toEqual(
        expect.arrayContaining([
          {
            OR: [
              { variantId: null },
              { variant: { isDeleted: false } },
            ],
          },
        ]),
      );
    });
  });

  describe('findByFranchiseAndProduct (POS + allocation critical path)', () => {
    it('filters out mappings whose variant is soft-deleted when a variantId is supplied', async () => {
      const { repo, captured } = buildRepo();
      await repo.findByFranchiseAndProduct('fr-1', 'prod-1', 'var-1');

      const where = captured.findFirst.where;
      expect(where).toMatchObject({
        franchiseId: 'fr-1',
        productId: 'prod-1',
        variantId: 'var-1',
        product: { isDeleted: false },
        variant: { isDeleted: false },
      });
    });

    it('does not require variant.isDeleted when variantId is null (product-level mapping)', async () => {
      const { repo, captured } = buildRepo();
      await repo.findByFranchiseAndProduct('fr-1', 'prod-1', null);

      const where = captured.findFirst.where;
      expect(where.product).toEqual({ isDeleted: false });
      expect(where.variantId).toBeNull();
      // Must NOT add a variant filter — there's no variant to check
      // and Prisma would otherwise exclude the row.
      expect(where.variant).toBeUndefined();
    });

    it('still filters product.isDeleted regardless of variant grain', async () => {
      // The product-level soft-delete guard should apply even for
      // variant-less mappings. A tombstoned product must not sell at
      // POS even if the franchise still has an isActive mapping.
      const { repo, captured } = buildRepo();
      await repo.findByFranchiseAndProduct('fr-1', 'prod-1', null);
      expect(captured.findFirst.where.product).toEqual({ isDeleted: false });
    });
  });
});
