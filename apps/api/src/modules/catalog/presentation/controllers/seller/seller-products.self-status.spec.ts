/**
 * 2026-06-13 — seller self-service pause/resume hardening (make-live bypass).
 *
 * A seller may pause (ACTIVE→SUSPENDED) and resume (SUSPENDED→ACTIVE) their own
 * listing. RESUME must run the publish-readiness/tax gate (reactivateInTransaction),
 * NOT the bare status write — otherwise a product whose tax config was reset (or,
 * combined with an admin parking a never-live product in SUSPENDED) could go live
 * with no tax verification and no super admin. Pause stays a bare write.
 */
import { SellerProductsController } from './seller-products.controller';
import { BadRequestAppException, ForbiddenAppException } from '../../../../../core/exceptions';

function makeController(overrides: any = {}) {
  const productRepo = {
    findByIdBasic: jest.fn(),
    findSellerById: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
    reactivateInTransaction: jest.fn().mockResolvedValue(undefined),
    updateStatusInTransaction: jest.fn().mockResolvedValue(undefined),
    ...(overrides.productRepo || {}),
  };
  const ownershipService = { validateOwnership: jest.fn().mockResolvedValue(undefined) };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
  const controller = new SellerProductsController(
    productRepo as any,
    {} as any, // variantRepo
    {} as any, // sellerMappingRepo
    {} as any, // metafieldRepo
    logger as any,
    {} as any, // slugService
    {} as any, // productCodeService
    ownershipService as any,
    {} as any, // reApprovalService
    {} as any, // eventBus
    {} as any, // metafieldValidation
    {} as any, // taxAttestation
    {} as any, // prisma
  );
  return { controller, productRepo, ownershipService };
}

describe('SellerProductsController.updateSelfStatus — resume runs the publish gate', () => {
  it('resume (SUSPENDED → ACTIVE) goes through reactivateInTransaction (gate), not the bare write', async () => {
    const { controller, productRepo } = makeController({
      productRepo: {
        findByIdBasic: jest.fn().mockResolvedValue({ id: 'p1', status: 'SUSPENDED', moderationStatus: 'APPROVED' }),
      },
    });

    const res = await controller.updateSelfStatus('seller1', 'p1', { status: 'ACTIVE' });

    expect(productRepo.reactivateInTransaction).toHaveBeenCalledTimes(1);
    expect(productRepo.updateStatusInTransaction).not.toHaveBeenCalled();
    expect(res.message).toMatch(/resumed/i);
  });

  it('resume when the gate fails → seller-friendly forbidden, NOT a live product', async () => {
    const { controller, productRepo } = makeController({
      productRepo: {
        findByIdBasic: jest.fn().mockResolvedValue({ id: 'p1', status: 'SUSPENDED', moderationStatus: 'APPROVED' }),
        reactivateInTransaction: jest
          .fn()
          .mockRejectedValue(new BadRequestAppException('Cannot publish — missing: taxConfigVerified')),
      },
    });

    await expect(controller.updateSelfStatus('seller1', 'p1', { status: 'ACTIVE' })).rejects.toBeInstanceOf(
      ForbiddenAppException,
    );
  });

  it('resume refused when the seller account is not active (no re-activation)', async () => {
    const { controller, productRepo } = makeController({
      productRepo: {
        findByIdBasic: jest.fn().mockResolvedValue({ id: 'p1', status: 'SUSPENDED', moderationStatus: 'APPROVED' }),
        findSellerById: jest.fn().mockResolvedValue({ status: 'SUSPENDED' }),
      },
    });

    await expect(controller.updateSelfStatus('seller1', 'p1', { status: 'ACTIVE' })).rejects.toThrow(
      /account is not active/i,
    );
    expect(productRepo.reactivateInTransaction).not.toHaveBeenCalled();
  });

  it('pause (ACTIVE → SUSPENDED) uses the bare status write (no gate)', async () => {
    const { controller, productRepo } = makeController({
      productRepo: {
        findByIdBasic: jest.fn().mockResolvedValue({ id: 'p1', status: 'ACTIVE', moderationStatus: 'APPROVED' }),
      },
    });

    const res = await controller.updateSelfStatus('seller1', 'p1', { status: 'SUSPENDED' });

    expect(productRepo.updateStatusInTransaction).toHaveBeenCalledTimes(1);
    expect(productRepo.reactivateInTransaction).not.toHaveBeenCalled();
    expect(res.message).toMatch(/paused/i);
  });
});
