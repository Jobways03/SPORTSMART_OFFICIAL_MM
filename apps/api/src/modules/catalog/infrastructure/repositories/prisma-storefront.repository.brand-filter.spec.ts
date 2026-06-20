/**
 * AD-BE-001 — regression lock for the multi-brand storefront filter bug.
 *
 * The storefront sidebar lets a shopper tick more than one brand, so the
 * listing endpoint receives `filter[brand]=id1,id2,...`. The controller
 * keeps that as a comma-joined string and the repository filtered with
 * `p.brand_id = ${brandFilter}` — i.e. comparing the column against the
 * whole "id1,id2" string, which matched nothing. The facet-count query
 * (storefront-filters.controller) already used `p.brand_id IN (...)`, so
 * the sidebar showed non-zero counts while the grid rendered 0 products.
 *
 * This spec pins the split-into-IN behaviour so the equality form can't
 * come back.
 */
import { PrismaStorefrontRepository } from './prisma-storefront.repository';

describe('PrismaStorefrontRepository.findProductsPaginated — brand filter', () => {
  const sqlText = (q: any): string => q?.sql ?? q?.strings?.join(' ') ?? String(q);

  const A = '2391482c-79cb-4f42-9786-c56464476fa7';
  const B = '338f068a-322c-4b1a-9c2d-000000000001';

  function makeRepo() {
    let capturedSql = '';
    const capturedValues: any[] = [];
    const prisma: any = {
      $queryRaw: jest.fn((q: any) => {
        capturedSql += sqlText(q);
        if (Array.isArray(q?.values)) capturedValues.push(...q.values);
        return Promise.resolve([{ total: 0 }]);
      }),
    };
    return { repo: new PrismaStorefrontRepository(prisma), get sql() { return capturedSql; }, values: capturedValues };
  }

  it('splits a multi-brand selection into an IN clause with separate bound ids', async () => {
    const ctx = makeRepo();
    await ctx.repo.findProductsPaginated({ page: 1, limit: 20, filterObj: { brand: `${A},${B}` } });

    // IN clause — NOT `p.brand_id = <joined string>`.
    expect(ctx.sql).toContain('brand_id IN (');
    expect(ctx.sql).not.toContain('brand_id = $');
    // Each id is bound as its own parameter, never the joined string.
    expect(ctx.values).toContain(A);
    expect(ctx.values).toContain(B);
    expect(ctx.values).not.toContain(`${A},${B}`);
  });

  it('still filters a single-brand selection (no regression)', async () => {
    const ctx = makeRepo();
    await ctx.repo.findProductsPaginated({ page: 1, limit: 20, filterObj: { brand: A } });

    expect(ctx.sql).toContain('brand_id IN (');
    expect(ctx.values).toContain(A);
  });

  it('drops blank brand entries instead of emitting an empty IN ()', async () => {
    const ctx = makeRepo();
    await ctx.repo.findProductsPaginated({ page: 1, limit: 20, filterObj: { brand: ' , ' } });

    expect(ctx.sql).not.toContain('brand_id IN ()');
    expect(ctx.sql).not.toContain('brand_id IN (');
  });
});
