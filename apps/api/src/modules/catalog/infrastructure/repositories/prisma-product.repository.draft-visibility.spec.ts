/**
 * 2026-06-13 — admin product list hides never-submitted drafts.
 *
 * A product the seller created but hasn't submitted for review (status=DRAFT +
 * moderationStatus=PENDING) must NOT appear in the default admin product list
 * (findAllPaginated with no status filter). Submitting flips status to
 * SUBMITTED, so submitted items still show; an explicit status=DRAFT filter
 * still surfaces drafts for admins who choose to look.
 */
import { PrismaProductRepository } from './prisma-product.repository';

function makeRepo() {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const repo = new PrismaProductRepository({ product: { findMany, count } } as any);
  return { repo, findMany };
}

describe('PrismaProductRepository.findAllPaginated — draft visibility', () => {
  it('excludes never-submitted drafts (DRAFT + moderationStatus PENDING) by default', async () => {
    const { repo, findMany } = makeRepo();
    await repo.findAllPaginated({ page: 1, limit: 10 } as any);
    const where = findMany.mock.calls[0][0].where;
    expect(where.NOT).toEqual([{ status: 'DRAFT', moderationStatus: 'PENDING' }]);
    expect(where.status).toBeUndefined();
  });

  it('does NOT add the exclusion when an explicit status filter is given (admins can view drafts)', async () => {
    const { repo, findMany } = makeRepo();
    await repo.findAllPaginated({ page: 1, limit: 10, status: 'DRAFT' } as any);
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe('DRAFT');
    expect(where.NOT).toBeUndefined();
  });

  it('keeps submitted products visible by default (they are SUBMITTED, not DRAFT)', async () => {
    // The NOT only targets DRAFT+PENDING; a SUBMITTED+PENDING row is not matched,
    // so it is not excluded. (Asserted via the predicate shape above — this test
    // documents the intent.)
    const { repo, findMany } = makeRepo();
    await repo.findAllPaginated({ page: 1, limit: 10 } as any);
    const where = findMany.mock.calls[0][0].where;
    expect(where.NOT).toEqual([{ status: 'DRAFT', moderationStatus: 'PENDING' }]);
  });
});
