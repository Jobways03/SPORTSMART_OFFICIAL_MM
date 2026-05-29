import 'reflect-metadata';
import { FranchiseCatalogService } from '../../src/modules/franchise/application/services/franchise-catalog.service';
import { PrismaFranchiseCatalogRepository } from '../../src/modules/franchise/infrastructure/repositories/prisma-franchise-catalog.repository';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../src/core/exceptions';

/**
 * Phase 159n — franchise catalog-mapping lifecycle hardening.
 * #6 hasVariants enforcement, #13 edit re-pend deactivates, #8 soft-remove +
 * stock/procurement guards, #5 decision actor/reason + history event.
 */

function buildService(opts: {
  product?: { status?: string; hasVariants?: boolean } | null;
  mapping?: { franchiseId: string; approvalStatus: string; productId?: string; variantId?: string | null } | null;
  onHandQty?: number;
  openProcurement?: boolean;
} = {}) {
  const catalogRepo: any = {
    findById: jest.fn().mockResolvedValue(opts.mapping ?? null),
    create: jest.fn().mockResolvedValue({ id: 'm-new' }),
    update: jest.fn().mockResolvedValue({ id: 'm-1' }),
    softRemove: jest.fn().mockResolvedValue(undefined),
  };
  const prisma: any = {
    product: {
      findFirst: jest.fn().mockResolvedValue(
        opts.product === null
          ? null
          : { id: 'prod-1', status: opts.product?.status ?? 'ACTIVE', hasVariants: opts.product?.hasVariants ?? false },
      ),
    },
    productVariant: {
      findUnique: jest.fn().mockResolvedValue({ id: 'var-1', productId: 'prod-1' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'var-1', productId: 'prod-1' }),
    },
    franchiseStock: {
      findFirst: jest.fn().mockResolvedValue(
        opts.onHandQty != null ? { onHandQty: opts.onHandQty } : null,
      ),
    },
    procurementRequestItem: {
      findFirst: jest.fn().mockResolvedValue(opts.openProcurement ? { id: 'pri-1' } : null),
    },
  };
  const svc = new FranchiseCatalogService(catalogRepo, prisma);
  return { svc, catalogRepo, prisma };
}

describe('FranchiseCatalogService.addMapping — hasVariants (#6)', () => {
  it('rejects a product-level mapping for a varianted product', async () => {
    const { svc } = buildService({ product: { hasVariants: true } });
    await expect(
      svc.addMapping('fr-1', { productId: 'prod-1', globalSku: 'SKU1' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('allows a variant-level mapping for a varianted product', async () => {
    const { svc, catalogRepo } = buildService({ product: { hasVariants: true } });
    await svc.addMapping('fr-1', { productId: 'prod-1', variantId: 'var-1', globalSku: 'SKU1' });
    expect(catalogRepo.create).toHaveBeenCalled();
  });
});

describe('FranchiseCatalogService.updateMapping — re-pend deactivates (#13)', () => {
  it('an edit on an APPROVED mapping sets PENDING_APPROVAL + isActive=false', async () => {
    const { svc, catalogRepo } = buildService({
      mapping: { franchiseId: 'fr-1', approvalStatus: 'APPROVED' },
    });
    await svc.updateMapping('fr-1', 'm-1', { franchiseSku: 'NEW' });
    expect(catalogRepo.update).toHaveBeenCalledWith(
      'm-1',
      expect.objectContaining({ approvalStatus: 'PENDING_APPROVAL', isActive: false }),
    );
  });
});

describe('FranchiseCatalogService.removeMapping — soft-delete + guards (#8)', () => {
  const mapping = { franchiseId: 'fr-1', approvalStatus: 'APPROVED', productId: 'prod-1', variantId: null };

  it('blocks removal when stock is on hand', async () => {
    const { svc } = buildService({ mapping, onHandQty: 5 });
    await expect(svc.removeMapping('fr-1', 'm-1')).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('blocks removal when an in-flight procurement references the SKU', async () => {
    const { svc } = buildService({ mapping, onHandQty: 0, openProcurement: true });
    await expect(svc.removeMapping('fr-1', 'm-1')).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('soft-removes (not hard delete) when clear', async () => {
    const { svc, catalogRepo } = buildService({ mapping, onHandQty: 0 });
    await svc.removeMapping('fr-1', 'm-1');
    expect(catalogRepo.softRemove).toHaveBeenCalledWith('m-1', 'fr-1');
  });

  it('404s a mapping owned by another franchise', async () => {
    const { svc } = buildService({
      mapping: { franchiseId: 'OTHER', approvalStatus: 'APPROVED', productId: 'prod-1', variantId: null },
    });
    await expect(svc.removeMapping('fr-1', 'm-1')).rejects.toBeInstanceOf(NotFoundAppException);
  });
});

describe('PrismaFranchiseCatalogRepository — decision actor + history (#5)', () => {
  function buildRepo() {
    const updated = { id: 'm-1', franchiseId: 'fr-1', productId: 'prod-1', variantId: null, approvalStatus: 'REJECTED' };
    const mappingUpdate = jest.fn().mockResolvedValue(updated);
    const eventCreate = jest.fn().mockResolvedValue({});
    const prisma: any = {
      franchiseCatalogMapping: { update: mappingUpdate },
      franchiseCatalogMappingEvent: { create: eventCreate },
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    const repo = new PrismaFranchiseCatalogRepository(prisma);
    return { repo, mappingUpdate, eventCreate };
  }

  it('reject stamps rejectedById + reason + writes a REJECTED history event', async () => {
    const { repo, mappingUpdate, eventCreate } = buildRepo();
    await repo.reject('m-1', 'admin-7', 'incorrect HSN');
    expect(mappingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          approvalStatus: 'REJECTED',
          isActive: false,
          rejectedById: 'admin-7',
          rejectionReason: 'incorrect HSN',
        }),
      }),
    );
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'REJECTED', actorId: 'admin-7', actorRole: 'ADMIN' }),
      }),
    );
  });

  it('approve stamps approvedById + writes an APPROVED history event', async () => {
    const { repo, mappingUpdate, eventCreate } = buildRepo();
    await repo.approve('m-1', 'admin-7');
    expect(mappingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approvalStatus: 'APPROVED', isActive: true, approvedById: 'admin-7' }),
      }),
    );
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'APPROVED' }) }),
    );
  });
});
