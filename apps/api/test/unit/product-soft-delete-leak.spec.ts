import 'reflect-metadata';
import { PrismaProductRepository } from '../../src/modules/catalog/infrastructure/repositories/prisma-product.repository';

/**
 * Regression test for the findFullProduct soft-delete leak.
 *
 * Before: findFullProduct used `findUnique({ where: { id } })` with no
 * isDeleted filter. Every other read in the repo filtered
 * `isDeleted: false`, so this one was an outlier that could return a
 * tombstoned product to an admin or seller who still had the id in
 * their URL or a stale cache.
 *
 * After: the query uses `findFirst({ where: { id, isDeleted: false } })`,
 * matching the rest of the repo.
 */

describe('PrismaProductRepository.findFullProduct — soft-delete leak', () => {
  const buildRepo = () => {
    const calls: any[] = [];
    const prisma: any = {
      product: {
        findFirst: jest.fn(async (args: any) => {
          calls.push({ method: 'findFirst', args });
          return null;
        }),
        findUnique: jest.fn(async (args: any) => {
          calls.push({ method: 'findUnique', args });
          return null;
        }),
      },
    };
    const repo = new PrismaProductRepository(prisma);
    return { repo, prisma, calls };
  };

  it('filters isDeleted:false so soft-deleted products never surface', async () => {
    const { repo, calls } = buildRepo();
    await repo.findFullProduct('prod-1');

    // The method MUST NOT call findUnique, because findUnique's `where`
    // accepts only unique fields and can't co-filter on isDeleted.
    const used = calls[0];
    expect(used.method).toBe('findFirst');
    expect(used.args.where).toEqual({ id: 'prod-1', isDeleted: false });
  });

  it('still filters child variants by isDeleted:false', async () => {
    const { repo, calls } = buildRepo();
    await repo.findFullProduct('prod-2');
    expect(calls[0].args.include.variants.where).toEqual({ isDeleted: false });
  });
});
