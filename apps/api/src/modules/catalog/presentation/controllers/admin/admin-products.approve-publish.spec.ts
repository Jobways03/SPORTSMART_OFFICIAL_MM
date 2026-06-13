/**
 * 2026-06-13 — decoupled approve → make-live workflow.
 *
 * Seller-admin "approve" is now CATALOG-ONLY: it moves a reviewed product to
 * status=APPROVED (not live) WITHOUT the publish-readiness/tax gate, so a seller
 * admin can sign off catalog content before the tax/finance team is involved.
 * Making it live (APPROVED → ACTIVE) is a separate SUPER_ADMIN step (publish /
 * status→ACTIVE) that runs the full gate (incl. taxConfigVerified) and emits the
 * "now live" event. These specs lock that contract at the controller boundary.
 */
import { AdminProductsController } from './admin-products.controller';

function makeController(overrides: any = {}) {
  const productRepo = {
    findByIdBasic: jest.fn(),
    catalogApproveInTransaction: jest.fn().mockResolvedValue(undefined),
    reactivateInTransaction: jest.fn().mockResolvedValue(undefined),
    updateStatusInTransaction: jest.fn().mockResolvedValue(undefined),
    ...(overrides.productRepo || {}),
  };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const metafieldValidation = {
    validateRequiredOnSubmit: jest.fn().mockResolvedValue({ missing: [] }),
  };
  const catalogCache = {
    invalidateProductLists: jest.fn().mockResolvedValue(undefined),
    invalidateProductDetail: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new AdminProductsController(
    productRepo as any,
    {} as any, // sellerMappingRepo
    logger as any,
    {} as any, // slugService
    {} as any, // productCodeService
    eventBus as any,
    {} as any, // cartFacade
    {} as any, // prisma
    metafieldValidation as any,
    {} as any, // taxAttestation
    catalogCache as any,
  );
  return { controller, productRepo, eventBus, metafieldValidation, catalogCache };
}

describe('AdminProductsController — catalog approve (decoupled from make-live)', () => {
  it('approve on a SUBMITTED product → catalog-only (APPROVED), no tax gate, no live event', async () => {
    const { controller, productRepo, eventBus } = makeController({
      productRepo: {
        findByIdBasic: jest.fn().mockResolvedValue({
          id: 'p1', status: 'SUBMITTED', moderationStatus: 'PENDING', slug: 's', categoryId: 'c1',
        }),
      },
    });

    const res = await controller.approveProduct('admin1', 'p1');

    expect(productRepo.catalogApproveInTransaction).toHaveBeenCalledTimes(1);
    const [pid, history] = productRepo.catalogApproveInTransaction.mock.calls[0];
    expect(pid).toBe('p1');
    expect(history[0]).toMatchObject({ toStatus: 'APPROVED' });
    // catalog-approve must NOT make it live or emit the "now live" event.
    expect(productRepo.reactivateInTransaction).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/super admin/i);
  });

  it('approve on an already-APPROVED product → idempotent, does NOT make it live', async () => {
    const { controller, productRepo } = makeController({
      productRepo: {
        findByIdBasic: jest.fn().mockResolvedValue({ id: 'p1', status: 'APPROVED', moderationStatus: 'APPROVED', slug: 's' }),
      },
    });

    const res = await controller.approveProduct('admin1', 'p1');

    expect(res.success).toBe(true);
    expect(res.message).toMatch(/already approved/i);
    expect(productRepo.catalogApproveInTransaction).not.toHaveBeenCalled();
    expect(productRepo.reactivateInTransaction).not.toHaveBeenCalled();
  });

  it('approve on an ACTIVE product → idempotent "already live"', async () => {
    const { controller, productRepo } = makeController({
      productRepo: {
        findByIdBasic: jest.fn().mockResolvedValue({ id: 'p1', status: 'ACTIVE', moderationStatus: 'APPROVED', slug: 's' }),
      },
    });
    const res = await controller.approveProduct('admin1', 'p1');
    expect(res.message).toMatch(/already live/i);
    expect(productRepo.catalogApproveInTransaction).not.toHaveBeenCalled();
  });
});

describe('AdminProductsController — make live (publish, SUPER_ADMIN step)', () => {
  it('publish on an APPROVED product → reactivate (runs gate) + emits live event + invalidates cache', async () => {
    const { controller, productRepo, eventBus, catalogCache } = makeController({
      productRepo: {
        findByIdBasic: jest.fn().mockResolvedValue({
          id: 'p1', status: 'APPROVED', moderationStatus: 'APPROVED', slug: 'shoe', title: 'Shoe', sellerId: 'sel1',
        }),
      },
    });

    const res = await controller.publishProduct('super1', 'p1');

    expect(productRepo.reactivateInTransaction).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(eventBus.publish.mock.calls[0][0]).toMatchObject({ eventName: 'catalog.listing.approved' });
    expect(catalogCache.invalidateProductLists).toHaveBeenCalled();
    expect(res.message).toMatch(/now live/i);
  });

  it('publish on a still-in-review (SUBMITTED) product → rejected, must catalog-approve first', async () => {
    const { controller, productRepo, eventBus } = makeController({
      productRepo: {
        findByIdBasic: jest.fn().mockResolvedValue({ id: 'p1', status: 'SUBMITTED', moderationStatus: 'PENDING', slug: 's' }),
      },
    });

    await expect(controller.publishProduct('super1', 'p1')).rejects.toThrow(/catalog-approve/i);
    expect(productRepo.reactivateInTransaction).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('publish on an already-live product → idempotent', async () => {
    const { controller, productRepo } = makeController({
      productRepo: {
        findByIdBasic: jest.fn().mockResolvedValue({ id: 'p1', status: 'ACTIVE', moderationStatus: 'APPROVED', slug: 's' }),
      },
    });
    const res = await controller.publishProduct('super1', 'p1');
    expect(res.message).toMatch(/already live/i);
    expect(productRepo.reactivateInTransaction).not.toHaveBeenCalled();
  });
});

describe('AdminProductsController — updateStatus → ACTIVE is SUPER_ADMIN-only', () => {
  const approvedProduct = { id: 'p1', status: 'APPROVED', moderationStatus: 'APPROVED', slug: 's' };

  it('non-super-admin setting status ACTIVE → forbidden, no re-activation', async () => {
    const { controller, productRepo } = makeController({
      productRepo: { findByIdBasic: jest.fn().mockResolvedValue(approvedProduct) },
    });

    await expect(
      controller.updateStatus('admin1', 'p1', { status: 'ACTIVE' } as any, { user: { roles: ['SELLER_ADMIN'] } }),
    ).rejects.toThrow(/super admin/i);
    expect(productRepo.reactivateInTransaction).not.toHaveBeenCalled();
  });

  it('super-admin setting status ACTIVE → re-activates through the gate', async () => {
    const { controller, productRepo } = makeController({
      productRepo: { findByIdBasic: jest.fn().mockResolvedValue(approvedProduct) },
    });

    const res = await controller.updateStatus(
      'super1', 'p1', { status: 'ACTIVE' } as any, { user: { roles: ['SUPER_ADMIN'] } },
    );
    expect(productRepo.reactivateInTransaction).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
  });

  it('non-super-admin setting a NON-live status (SUSPENDED) on a LIVE product → allowed', async () => {
    const { controller, productRepo } = makeController({
      productRepo: {
        findByIdBasic: jest.fn().mockResolvedValue({ id: 'p1', status: 'ACTIVE', moderationStatus: 'APPROVED', slug: 's' }),
      },
    });
    const res = await controller.updateStatus(
      'admin1', 'p1', { status: 'SUSPENDED' } as any, { user: { roles: ['SELLER_ADMIN'] } },
    );
    expect(productRepo.updateStatusInTransaction).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
  });

  // Bypass closure: a never-live APPROVED product can no longer be parked in
  // SUSPENDED (which the seller self-status resume could then flip live ungated).
  it('APPROVED → SUSPENDED is rejected (closes the never-live make-live bypass)', async () => {
    const { controller, productRepo } = makeController({
      productRepo: {
        findByIdBasic: jest.fn().mockResolvedValue({ id: 'p1', status: 'APPROVED', moderationStatus: 'APPROVED', slug: 's' }),
      },
    });
    await expect(
      controller.updateStatus('admin1', 'p1', { status: 'SUSPENDED' } as any, { user: { roles: ['SELLER_ADMIN'] } }),
    ).rejects.toThrow(/Cannot transition from APPROVED to SUSPENDED/i);
    expect(productRepo.updateStatusInTransaction).not.toHaveBeenCalled();
  });
});
