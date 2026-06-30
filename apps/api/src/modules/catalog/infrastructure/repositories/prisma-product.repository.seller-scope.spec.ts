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

  /**
   * 2026-06-30 — central-catalog (null-owner) inclusion.
   *
   * A product created by SUPER_ADMIN has sellerId=null (no owner). When an
   * in-channel seller maps & gets approved on it, the admin catalog list (which
   * always sends hasSellers=true) must show it — otherwise an approved offer of
   * a master-catalog product has no surface anywhere. Cross-channel OWNED
   * products stay hidden (the exception is gated on sellerId=null).
   *
   * Fails on the pre-fix code (scope was a flat owner-only AND clause).
   */
  it('includes central-catalog (null-owner) products mapped by an in-channel seller when hasSellers=true', async () => {
    const { repo, findMany } = makeRepo();
    await repo.findAllPaginated({
      page: 1,
      limit: 10,
      allowedSellerTypes: ['RETAIL'],
      hasSellers: true,
    } as any);
    const where = findMany.mock.calls[0][0].where;

    const scopeClause = (where.AND ?? []).find((c: any) => Array.isArray(c?.OR));
    expect(scopeClause).toBeDefined();
    expect(scopeClause.OR).toEqual(
      expect.arrayContaining([
        // owned by my own channel
        { seller: { sellerType: { in: ['RETAIL'] } } },
        // central-catalog product offered by my own channel
        {
          sellerId: null,
          sellerMappings: { some: { seller: { sellerType: { in: ['RETAIL'] } } } },
        },
      ]),
    );
  });

  it('keeps cross-channel isolation: the central-catalog exception requires a null owner', async () => {
    // The only way a non-owned product enters the scope is the central-catalog
    // branch, and that branch requires sellerId=null — so a product OWNED by
    // another channel's seller (non-null owner, wrong type) matches no branch.
    const { repo, findMany } = makeRepo();
    await repo.findAllPaginated({
      page: 1,
      limit: 10,
      allowedSellerTypes: ['RETAIL'],
      hasSellers: true,
    } as any);
    const where = findMany.mock.calls[0][0].where;
    const scopeClause = (where.AND ?? []).find((c: any) => Array.isArray(c?.OR));
    const offerBranch = scopeClause.OR.find((b: any) => b.sellerMappings);
    expect(offerBranch).toMatchObject({ sellerId: null });
  });

  it('keeps the strict owner-only scope when hasSellers is not set', async () => {
    const { repo, findMany } = makeRepo();
    await repo.findAllPaginated({
      page: 1,
      limit: 10,
      allowedSellerTypes: ['RETAIL'],
    } as any);
    const where = findMany.mock.calls[0][0].where;
    const scopeClause = (where.AND ?? []).find((c: any) => c?.seller?.sellerType);
    expect(scopeClause).toEqual({ seller: { sellerType: { in: ['RETAIL'] } } });
    expect(JSON.stringify(where.AND ?? [])).not.toContain('sellerMappings');
  });

  it('applies the same central-catalog inclusion for a D2C-scoped admin', async () => {
    // The fix is generic over allowedSellerTypes, so the D2C seller-admin
    // (web-d2c-seller-admin, which also sends hasSellers=true) gets the same
    // central-catalog visibility as retail — no D2C-specific code path exists.
    const { repo, findMany } = makeRepo();
    await repo.findAllPaginated({
      page: 1,
      limit: 10,
      allowedSellerTypes: ['D2C'],
      hasSellers: true,
    } as any);
    const where = findMany.mock.calls[0][0].where;
    const scopeClause = (where.AND ?? []).find((c: any) => Array.isArray(c?.OR));
    expect(scopeClause.OR).toEqual(
      expect.arrayContaining([
        { seller: { sellerType: { in: ['D2C'] } } },
        {
          sellerId: null,
          sellerMappings: { some: { seller: { sellerType: { in: ['D2C'] } } } },
        },
      ]),
    );
  });
});
