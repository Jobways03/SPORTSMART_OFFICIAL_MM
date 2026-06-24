/**
 * 2026-06-24 — channel isolation on the admin product list.
 *
 * A seller-type-scoped admin (D2C / RETAIL) sees ONLY products OWNED by a
 * seller of their own channel. A product owned by another channel — even one a
 * same-channel seller merely OFFERS (maps) — must NOT appear in this list. The
 * previous behaviour also matched products via a `sellerMappings.some(...)`
 * offer branch; that surfaced e.g. a retailer-owned product in the D2C admin
 * just because a D2C seller had a (even pending) offer. Cross-channel offers
 * are now handled solely by the "Pending Seller Approvals" surface.
 */
import { PrismaProductRepository } from './prisma-product.repository';

function makeRepo() {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const repo = new PrismaProductRepository({ product: { findMany, count } } as any);
  return { repo, findMany };
}

describe('PrismaProductRepository.findAllPaginated — seller-type channel isolation', () => {
  it('scopes a D2C admin to products OWNED by a D2C seller — no offer (sellerMappings) branch', async () => {
    const { repo, findMany } = makeRepo();
    await repo.findAllPaginated({ page: 1, limit: 10, allowedSellerTypes: ['D2C'] } as any);
    const where = findMany.mock.calls[0][0].where;

    const scopeClause = (where.AND ?? []).find((c: any) => c?.seller?.sellerType);
    expect(scopeClause).toEqual({ seller: { sellerType: { in: ['D2C'] } } });

    // The old owner-OR-offer matching is gone: nothing in the scope filter
    // references sellerMappings any more.
    expect(JSON.stringify(where.AND ?? [])).not.toContain('sellerMappings');
  });

  it('applies NO seller-type filter for an unrestricted admin', async () => {
    const { repo, findMany } = makeRepo();
    await repo.findAllPaginated({ page: 1, limit: 10 } as any);
    const where = findMany.mock.calls[0][0].where;
    const scopeClause = (where.AND ?? []).find((c: any) => c?.seller?.sellerType);
    expect(scopeClause).toBeUndefined();
  });
});
