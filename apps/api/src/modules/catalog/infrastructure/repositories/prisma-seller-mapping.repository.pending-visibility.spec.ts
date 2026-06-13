/**
 * 2026-06-13 — pending-approval queue hides never-submitted drafts' mappings.
 *
 * A seller's PENDING_APPROVAL mapping should NOT surface in the admin pending-
 * approvals queue (or the sidebar badge count, which uses the same query) while
 * its product is still a never-submitted draft (status=DRAFT + moderationStatus
 * PENDING). Once the seller submits the product (it leaves DRAFT), the mapping
 * reappears. Consistent with the admin product list hiding such drafts.
 */
import { PrismaSellerMappingRepository } from './prisma-seller-mapping.repository';

describe('PrismaSellerMappingRepository.findPendingPaginated — draft visibility', () => {
  it('excludes mappings whose product is a never-submitted draft', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const repo = new PrismaSellerMappingRepository({
      sellerProductMapping: { findMany, count },
    } as any);

    await repo.findPendingPaginated(1, 10);

    const where = findMany.mock.calls[0][0].where;
    expect(where.approvalStatus).toBe('PENDING_APPROVAL');
    expect(where.product).toEqual({
      NOT: { status: 'DRAFT', moderationStatus: 'PENDING' },
    });
    // count uses the same predicate so the badge stays consistent
    expect(count.mock.calls[0][0].where.product).toEqual({
      NOT: { status: 'DRAFT', moderationStatus: 'PENDING' },
    });
  });
});
