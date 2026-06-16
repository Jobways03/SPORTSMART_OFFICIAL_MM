/**
 * 2026-06-15 — resumeBySeller is the inverse of the seller pause and the
 * security guard for it: the WHERE matches STOPPED rows stopped by THIS seller
 * (stoppedBy === sellerId), so a seller can NEVER lift an admin STOP/SUSPEND.
 */
import { PrismaSellerMappingRepository } from './prisma-seller-mapping.repository';

describe('PrismaSellerMappingRepository.resumeBySeller', () => {
  it('updates only STOPPED rows stopped by this seller, clearing the pause', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest.fn().mockResolvedValue({ id: 'm1', approvalStatus: 'APPROVED' });
    const repo = new PrismaSellerMappingRepository({
      sellerProductMapping: { updateMany, findUnique },
    } as any);

    const res = await repo.resumeBySeller('m1', 'seller-1');

    const { where, data } = updateMany.mock.calls[0][0];
    expect(where).toMatchObject({
      id: 'm1',
      approvalStatus: 'STOPPED',
      stoppedBy: 'seller-1', // the guard — admin stops (stoppedBy≠seller) won't match
      deletedAt: null,
    });
    expect(data).toMatchObject({
      approvalStatus: 'APPROVED',
      isActive: true,
      stoppedBy: null,
      stoppedAt: null,
    });
    expect(res).toEqual({ id: 'm1', approvalStatus: 'APPROVED' });
  });

  it('returns null when nothing matches (e.g. an admin STOP — not the seller’s own)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const findUnique = jest.fn();
    const repo = new PrismaSellerMappingRepository({
      sellerProductMapping: { updateMany, findUnique },
    } as any);

    const res = await repo.resumeBySeller('m1', 'seller-1');

    expect(res).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
