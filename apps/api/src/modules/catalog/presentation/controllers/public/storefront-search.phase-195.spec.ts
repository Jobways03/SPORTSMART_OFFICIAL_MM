/**
 * Phase 195 — catalog-path search hardening in the repo:
 *   #10 name_asc / name_desc produce ORDER BY p.title (were unhandled)
 *   #20 every sort ends with p.id ASC (deterministic OFFSET pagination)
 *   #9  the ILIKE pattern is wildcard-escaped before binding
 */
import { PrismaStorefrontRepository } from '../../../infrastructure/repositories/prisma-storefront.repository';

function makeRepo() {
  const $queryRaw = jest.fn().mockResolvedValue([]);
  const repo = new PrismaStorefrontRepository({ $queryRaw } as any);
  return { repo, $queryRaw };
}

// The data query is the 2nd $queryRaw call (count is first).
const dataSql = (q: any) => (typeof q.sql === 'string' ? q.sql : (q.strings ?? []).join('?'));

describe('PrismaStorefrontRepository.findProductsPaginated — Phase 195 sort', () => {
  it('#10 name_asc → ORDER BY p.title ASC with #20 id tiebreak', async () => {
    const { repo, $queryRaw } = makeRepo();
    await repo.findProductsPaginated({ page: 1, limit: 20, sortBy: 'name_asc', filterObj: {} } as any);
    const sql = dataSql($queryRaw.mock.calls[1][0]);
    expect(sql).toContain('p.title ASC');
    expect(sql).toContain('p.id ASC');
  });

  it('#10 name_desc → ORDER BY p.title DESC', async () => {
    const { repo, $queryRaw } = makeRepo();
    await repo.findProductsPaginated({ page: 1, limit: 20, sortBy: 'name_desc', filterObj: {} } as any);
    expect(dataSql($queryRaw.mock.calls[1][0])).toContain('p.title DESC');
  });

  it('#20 default (created_at) sort also carries the id tiebreak', async () => {
    const { repo, $queryRaw } = makeRepo();
    await repo.findProductsPaginated({ page: 1, limit: 20, filterObj: {} } as any);
    const sql = dataSql($queryRaw.mock.calls[1][0]);
    expect(sql).toContain('p.created_at DESC');
    expect(sql).toContain('p.id ASC');
  });

  it('#9 escapes LIKE wildcards in the bound search pattern', async () => {
    const { repo, $queryRaw } = makeRepo();
    await repo.findProductsPaginated({ page: 1, limit: 20, search: '100%', filterObj: {} } as any);
    const values: unknown[] = $queryRaw.mock.calls[1][0].values ?? [];
    // escapeLikePattern('100%') === '100\%'; wrapped → '%100\%%'
    expect(values).toContain('%100\\%%');
    expect(values).not.toContain('%100%%');
  });
});

describe('PrismaStorefrontRepository.findSearchSuggestions — Phase 195', () => {
  it('#9 escapes the typeahead pattern', async () => {
    const { repo, $queryRaw } = makeRepo();
    await repo.findSearchSuggestions('ab_');
    const values: unknown[] = $queryRaw.mock.calls[0][0].values ?? [];
    // escapeLikePattern('ab_') === 'ab\_'; wrapped → '%ab\_%'
    expect(values).toContain('%ab\\_%');
  });
});
