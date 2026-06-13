/**
 * 2026-06-13 — catalogApproveInTransaction: catalog-only approval.
 *
 * Moves a review-state product → status=APPROVED + moderationStatus=APPROVED
 * (NOT live). Unlike approveInTransaction it must NOT run the publish gate and
 * must NOT activate variants — those happen at make-live (reactivateInTransaction),
 * a separate SUPER_ADMIN step after the HSN/tax config is set. CAS-guarded so two
 * concurrent approvals can't both land.
 */
import { PrismaProductRepository } from './prisma-product.repository';

function makeRepo(updateManyResult: { count: number }) {
  const productUpdateMany = jest.fn().mockResolvedValue(updateManyResult);
  const historyCreate = jest.fn().mockResolvedValue({});
  const variantUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
  const tx = {
    product: { updateMany: productUpdateMany },
    productStatusHistory: { create: historyCreate },
    productVariant: { updateMany: variantUpdateMany },
  };
  const $transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
  const repo = new PrismaProductRepository({ $transaction } as any);
  return { repo, productUpdateMany, historyCreate, variantUpdateMany };
}

describe('PrismaProductRepository.catalogApproveInTransaction', () => {
  it('flips to APPROVED (not ACTIVE), CAS over review states, no variant activation', async () => {
    const { repo, productUpdateMany, historyCreate, variantUpdateMany } = makeRepo({ count: 1 });

    await repo.catalogApproveInTransaction(
      'p1',
      [{ fromStatus: 'SUBMITTED', toStatus: 'APPROVED', changedBy: 'a1', reason: 'Catalog approved' }],
      { moderatorId: 'a1' },
    );

    expect(productUpdateMany).toHaveBeenCalledTimes(1);
    const arg = productUpdateMany.mock.calls[0][0];
    expect(arg.data.status).toBe('APPROVED');
    expect(arg.data.moderationStatus).toBe('APPROVED');
    // CAS over the review states only — can't approve an already-live row.
    expect(arg.where.status.in).toEqual(['SUBMITTED', 'DRAFT', 'REJECTED', 'CHANGES_REQUESTED']);
    // Catalog-approve must NOT activate variants (that's make-live's job).
    expect(variantUpdateMany).not.toHaveBeenCalled();
    // History row written.
    expect(historyCreate).toHaveBeenCalledTimes(1);
    expect(historyCreate.mock.calls[0][0].data).toMatchObject({ productId: 'p1', toStatus: 'APPROVED' });
  });

  it('throws when the CAS update matches no row (concurrent change)', async () => {
    const { repo, historyCreate } = makeRepo({ count: 0 });
    await expect(
      repo.catalogApproveInTransaction('p1', [{ toStatus: 'APPROVED' }], { moderatorId: 'a1' }),
    ).rejects.toThrow(/concurrently/i);
    expect(historyCreate).not.toHaveBeenCalled();
  });
});
