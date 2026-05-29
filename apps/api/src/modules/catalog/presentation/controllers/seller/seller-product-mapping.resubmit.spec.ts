/**
 * Phase 56 (2026-05-22) — pins the seller resubmit endpoint (audit
 * Gap #11) and the multi-variant P2002 race catch (audit Gap #5).
 */

import 'reflect-metadata';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../../core/exceptions';
import { SellerProductMappingController } from './seller-product-mapping.controller';

const noopLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setContext: jest.fn(),
} as any;

function buildController(over: {
  findById?: jest.Mock;
  resubmit?: jest.Mock;
  findBySellerForProduct?: jest.Mock;
  createMany?: jest.Mock;
  findProductForMapping?: jest.Mock;
} = {}) {
  const sellerMappingRepo: any = {
    findById: over.findById ?? jest.fn(),
    resubmit: over.resubmit ?? jest.fn(),
    findBySellerForProduct: over.findBySellerForProduct ?? jest.fn().mockResolvedValue([]),
    createMany: over.createMany ?? jest.fn(),
    findProductForMapping: over.findProductForMapping ?? jest.fn(),
    findVariantForMapping: jest.fn(),
    findPostOfficeByPincode: jest.fn(),
    findBySellerAndProduct: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    findManyByIdsForSeller: jest.fn(),
    bulkUpdateStockWithBefore: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    updateWithRowLock: jest.fn(),
    listStockMovementsForMapping: jest.fn(),
    autoRepairMissingMappingsForSeller: jest.fn().mockResolvedValue(0),
  };
  const storefrontRepo: any = {};
  const stockSyncService: any = { syncVariantStockFromMappings: jest.fn() };
  const stockLedger: any = { record: jest.fn().mockResolvedValue(undefined) };
  const redis: any = { acquireLock: jest.fn().mockResolvedValue(false) };
  // Phase 58 (2026-05-22) — constructor expanded with audit + event +
  // cache deps for the new /pause endpoint.
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const catalogCache: any = { invalidateProductLists: jest.fn().mockResolvedValue(undefined) };
  return new SellerProductMappingController(
    sellerMappingRepo,
    storefrontRepo,
    noopLogger,
    stockSyncService,
    stockLedger,
    redis,
    audit,
    eventBus,
    catalogCache,
  );
}

function req(sellerId = 'seller-1'): any {
  return { sellerId };
}

describe('SellerProductMappingController.resubmitMapping (Phase 56 — audit Gap #11)', () => {
  it('throws NotFound when mapping does not exist', async () => {
    const ctrl = buildController({ findById: jest.fn().mockResolvedValue(null) });
    await expect(ctrl.resubmitMapping(req(), 'm-ghost')).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });

  it('throws NotFound when mapping is soft-deleted', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({ id: 'm-1', deletedAt: new Date() }),
    });
    await expect(ctrl.resubmitMapping(req(), 'm-1')).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });

  it('throws Forbidden when mapping belongs to another seller', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({
        id: 'm-1',
        sellerId: 'OTHER',
        approvalStatus: 'REJECTED',
        deletedAt: null,
      }),
    });
    await expect(ctrl.resubmitMapping(req('seller-1'), 'm-1')).rejects.toBeInstanceOf(
      ForbiddenAppException,
    );
  });

  it('throws BadRequest when mapping is not REJECTED', async () => {
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({
        id: 'm-1',
        sellerId: 'seller-1',
        approvalStatus: 'APPROVED',
        deletedAt: null,
      }),
    });
    await expect(ctrl.resubmitMapping(req('seller-1'), 'm-1')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });

  it('calls repo.resubmit on a REJECTED mapping owned by the seller', async () => {
    const resubmit = jest
      .fn()
      .mockResolvedValue({ id: 'm-1', approvalStatus: 'PENDING_APPROVAL' });
    const ctrl = buildController({
      findById: jest.fn().mockResolvedValue({
        id: 'm-1',
        sellerId: 'seller-1',
        approvalStatus: 'REJECTED',
        deletedAt: null,
      }),
      resubmit,
    });

    const out = await ctrl.resubmitMapping(req('seller-1'), 'm-1');
    expect(resubmit).toHaveBeenCalledWith('m-1');
    expect((out as any).data.approvalStatus).toBe('PENDING_APPROVAL');
  });
});

describe('SellerProductMappingController.mapProduct multi-variant P2002 catch (Phase 56 — audit Gap #5)', () => {
  it('translates Prisma P2002 from createMany into ConflictAppException', async () => {
    const p2002 = Object.assign(new Error('unique violation'), { code: 'P2002' });
    const ctrl = buildController({
      findProductForMapping: jest.fn().mockResolvedValue({
        id: 'p-1',
        status: 'ACTIVE',
        isDeleted: false,
        hasVariants: true,
        variants: [
          { id: 'v-1' },
          { id: 'v-2' },
        ],
      }),
      findBySellerForProduct: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockRejectedValue(p2002),
    });

    await expect(
      ctrl.mapProduct(req('seller-1'), {
        productId: 'p-1',
        stockQty: 5,
      } as any),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/concurrent request/i),
    });
  });
});
