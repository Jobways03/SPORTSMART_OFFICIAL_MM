import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { FranchiseCatalogRepository } from '../../domain/repositories/franchise-catalog.repository.interface';

@Injectable()
export class PrismaFranchiseCatalogRepository implements FranchiseCatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByFranchiseId(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      search?: string;
      isActive?: boolean;
      approvalStatus?: string;
    },
  ): Promise<{ mappings: any[]; total: number }> {
    // Exclude mappings whose underlying variant has been soft-deleted
    // by the seller. A mapping pointing to a dead variant is an orphan
    // — keeping it in the list would let the franchise UI surface a
    // product they can no longer stock or sell. Product-level
    // mappings (variantId=null) stay visible.
    //
    // We compose with AND rather than the top-level OR so the search
    // branch below can add its own OR without clobbering this one.
    const where: any = {
      franchiseId,
      product: { isDeleted: false },
      AND: [
        { OR: [{ variantId: null }, { variant: { isDeleted: false } }] },
      ] as any[],
    };

    if (params.isActive !== undefined) {
      where.isActive = params.isActive;
    }

    if (params.approvalStatus) {
      where.approvalStatus = params.approvalStatus;
    }

    if (params.search) {
      where.AND.push({
        OR: [
          { globalSku: { contains: params.search, mode: 'insensitive' } },
          { franchiseSku: { contains: params.search, mode: 'insensitive' } },
          { barcode: { contains: params.search, mode: 'insensitive' } },
          { product: { title: { contains: params.search, mode: 'insensitive' }, isDeleted: false } },
        ],
      });
    }

    const skip = (params.page - 1) * params.limit;

    const [mappings, total] = await this.prisma.$transaction([
      this.prisma.franchiseCatalogMapping.findMany({
        where,
        include: {
          product: {
            include: {
              category: true,
              brand: true,
              images: { where: { sortOrder: 0 }, take: 1 },
            },
          },
          variant: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.franchiseCatalogMapping.count({ where }),
    ]);

    return { mappings, total };
  }

  async findById(id: string): Promise<any | null> {
    return this.prisma.franchiseCatalogMapping.findUnique({
      where: { id },
      include: {
        product: {
          include: {
            category: true,
            brand: true,
            images: { where: { sortOrder: 0 }, take: 1 },
          },
        },
        variant: true,
      },
    });
  }

  async findByFranchiseAndProduct(
    franchiseId: string,
    productId: string,
    variantId: string | null,
  ): Promise<any | null> {
    // Critical: this lookup is how POS + allocation decide whether a
    // franchise is permitted to sell / fulfil a given SKU. If the
    // product has been soft-deleted, or the variant has been
    // soft-deleted, the mapping must NOT be considered live even if
    // the FranchiseCatalogMapping row still exists. Without this
    // guard, a POS operator could scan a tombstoned barcode and the
    // sale would pass validation.
    return this.prisma.franchiseCatalogMapping.findFirst({
      where: {
        franchiseId,
        productId,
        variantId: variantId ?? null,
        product: { isDeleted: false },
        ...(variantId ? { variant: { isDeleted: false } } : {}),
      },
    });
  }

  /**
   * Phase 159n (audit #1/#2/#7) — APPROVED + active variant of the lookup
   * above. POS, procurement-request creation, and manual stock adjustment must
   * use THIS so a franchise can't transact (sell / procure / hold stock)
   * against a mapping the admin hasn't vetted. The unfiltered
   * findByFranchiseAndProduct stays for read/display paths.
   */
  async findApprovedActiveByFranchiseAndProduct(
    franchiseId: string,
    productId: string,
    variantId: string | null,
  ): Promise<any | null> {
    return this.prisma.franchiseCatalogMapping.findFirst({
      where: {
        franchiseId,
        productId,
        variantId: variantId ?? null,
        approvalStatus: 'APPROVED',
        isActive: true,
        product: { isDeleted: false },
        ...(variantId ? { variant: { isDeleted: false } } : {}),
      },
    });
  }

  async create(data: {
    franchiseId: string;
    productId: string;
    variantId?: string;
    globalSku: string;
    franchiseSku?: string;
    barcode?: string;
    isListedForOnlineFulfillment?: boolean;
  }): Promise<any> {
    return this.prisma.franchiseCatalogMapping.create({
      data,
      include: {
        product: {
          include: {
            category: true,
            brand: true,
            images: { where: { sortOrder: 0 }, take: 1 },
          },
        },
        variant: true,
      },
    });
  }

  async createMany(
    data: Array<{
      franchiseId: string;
      productId: string;
      variantId?: string;
      globalSku: string;
      franchiseSku?: string;
      barcode?: string;
      isListedForOnlineFulfillment?: boolean;
    }>,
  ): Promise<number> {
    const result = await this.prisma.franchiseCatalogMapping.createMany({
      data,
      skipDuplicates: true,
    });
    return result.count;
  }

  async update(id: string, data: Record<string, unknown>): Promise<any> {
    return this.prisma.franchiseCatalogMapping.update({
      where: { id },
      data,
      include: {
        product: {
          include: {
            category: true,
            brand: true,
            images: { where: { sortOrder: 0 }, take: 1 },
          },
        },
        variant: true,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.franchiseCatalogMapping.delete({ where: { id } });
  }

  /**
   * Phase 159n (audit #8) — soft-remove. Replaces the hard delete so the row +
   * its approval history survive (a franchise can't "wash" approval state by
   * delete-and-recreate, and existing stock/order references aren't orphaned).
   * Sets STOPPED + isActive=false + removedAt/By and appends a REMOVED event.
   */
  async softRemove(id: string, actorId?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.franchiseCatalogMapping.update({
        where: { id },
        data: {
          approvalStatus: 'STOPPED',
          isActive: false,
          removedById: actorId ?? null,
          removedAt: new Date(),
          version: { increment: 1 },
        },
        select: { id: true, franchiseId: true, productId: true, variantId: true },
      });
      await tx.franchiseCatalogMappingEvent.create({
        data: {
          mappingId: id,
          franchiseId: updated.franchiseId,
          productId: updated.productId,
          variantId: updated.variantId,
          action: 'REMOVED',
          actorId: actorId ?? null,
          actorRole: 'FRANCHISE',
        },
      });
    });
  }

  async findAvailableProducts(params: {
    page: number;
    limit: number;
    search?: string;
    categoryId?: string;
    brandId?: string;
    excludeFranchiseId?: string;
  }): Promise<{ products: any[]; total: number }> {
    const where: any = {
      status: 'ACTIVE',
      isDeleted: false,
    };

    // Combine the search clause and the franchise-exclusion clause via
    // an explicit AND so they don't collide on the top-level OR slot.
    const andClauses: any[] = [];

    if (params.search) {
      andClauses.push({
        OR: [
          { title: { contains: params.search, mode: 'insensitive' } },
          { baseSku: { contains: params.search, mode: 'insensitive' } },
          { productCode: { contains: params.search, mode: 'insensitive' } },
        ],
      });
    }

    if (params.categoryId) {
      where.categoryId = params.categoryId;
    }

    if (params.brandId) {
      where.brandId = params.brandId;
    }

    // Hide a product from Browse only when *all* its slots are taken:
    //   - Non-variant product: hide once a product-level mapping exists
    //     (variantId=null) for this franchise.
    //   - Variant product: hide only when every active variant already
    //     has a mapping. If even one variant is still unmapped, the
    //     product stays visible so the franchise can add the rest.
    // This relies on the ProductVariant.franchiseCatalogMappings back
    // relation (declared on the variant model) for the inner `none`
    // query.
    if (params.excludeFranchiseId) {
      andClauses.push({
        OR: [
          {
            hasVariants: false,
            franchiseCatalogMappings: {
              none: {
                franchiseId: params.excludeFranchiseId,
                variantId: null,
              },
            },
          },
          {
            hasVariants: true,
            variants: {
              some: {
                isDeleted: false,
                franchiseCatalogMappings: {
                  none: { franchiseId: params.excludeFranchiseId },
                },
              },
            },
          },
        ],
      });
    }

    if (andClauses.length > 0) {
      where.AND = andClauses;
    }

    const skip = (params.page - 1) * params.limit;

    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: {
          category: true,
          brand: true,
          images: { where: { sortOrder: 0 }, take: 1 },
          variants: {
            where: { isDeleted: false },
            select: {
              id: true,
              title: true,
              sku: true,
              masterSku: true,
              barcode: true,
              price: true,
              stock: true,
              status: true,
            },
          },
          // Surface this franchise's existing mappings on each product
          // so the Add-to-Catalog modal can pre-disable variants that
          // are already in the catalog (preventing duplicate-key
          // errors and making the partial-mapping state visible).
          franchiseCatalogMappings: params.excludeFranchiseId
            ? {
                where: { franchiseId: params.excludeFranchiseId },
                select: { id: true, variantId: true, approvalStatus: true },
              }
            : false,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { products, total };
  }

  // Phase 159n (audit #5) — decision write-back now stamps the actor/reason
  // columns, bumps the OCC version, and appends a history-event row in one
  // transaction. `actorId` is the admin; `reason` is persisted for reject/stop.
  private async applyDecision(
    id: string,
    decision: {
      action: 'APPROVED' | 'REJECTED' | 'STOPPED';
      data: Record<string, unknown>;
      reason?: string | null;
      actorId?: string;
    },
  ): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.franchiseCatalogMapping.update({
        where: { id },
        data: { ...decision.data, version: { increment: 1 } },
        include: {
          product: {
            include: {
              category: true,
              brand: true,
              images: { where: { sortOrder: 0 }, take: 1 },
            },
          },
          variant: true,
        },
      });
      await tx.franchiseCatalogMappingEvent.create({
        data: {
          mappingId: id,
          franchiseId: updated.franchiseId,
          productId: updated.productId,
          variantId: updated.variantId,
          action: decision.action,
          reason: decision.reason ?? null,
          actorId: decision.actorId ?? null,
          actorRole: 'ADMIN',
        },
      });
      return updated;
    });
  }

  async approve(id: string, actorId?: string): Promise<any> {
    return this.applyDecision(id, {
      action: 'APPROVED',
      actorId,
      data: {
        approvalStatus: 'APPROVED',
        isActive: true,
        approvedById: actorId ?? null,
        approvedAt: new Date(),
      },
    });
  }

  async stop(id: string, actorId?: string, reason?: string | null): Promise<any> {
    return this.applyDecision(id, {
      action: 'STOPPED',
      actorId,
      reason,
      data: {
        approvalStatus: 'STOPPED',
        isActive: false,
        stoppedById: actorId ?? null,
        stoppedAt: new Date(),
        stopReason: reason ?? null,
      },
    });
  }

  async reject(id: string, actorId?: string, reason?: string | null): Promise<any> {
    // Rejection puts the mapping into a "needs fixing" state. The
    // franchise can edit and re-submit, which flips the status back
    // to PENDING_APPROVAL via FranchiseCatalogService.updateMapping.
    // We set isActive=false so the row doesn't accidentally become
    // routing-eligible while in REJECTED limbo.
    return this.applyDecision(id, {
      action: 'REJECTED',
      actorId,
      reason,
      data: {
        approvalStatus: 'REJECTED',
        isActive: false,
        rejectedById: actorId ?? null,
        rejectedAt: new Date(),
        rejectionReason: reason ?? null,
      },
    });
  }

  async findAllPaginated(params: {
    page: number;
    limit: number;
    franchiseId?: string;
    approvalStatus?: string;
    search?: string;
  }): Promise<{ mappings: any[]; total: number }> {
    // Same soft-deleted-variant filter as the per-franchise list
    // (see findByFranchiseId). Orphan mappings must not surface in the
    // admin-wide catalog view either.
    const where: any = {
      product: { isDeleted: false },
      AND: [
        { OR: [{ variantId: null }, { variant: { isDeleted: false } }] },
      ] as any[],
    };

    if (params.franchiseId) {
      where.franchiseId = params.franchiseId;
    }

    if (params.approvalStatus) {
      where.approvalStatus = params.approvalStatus;
    }

    if (params.search) {
      where.AND.push({
        OR: [
          { globalSku: { contains: params.search, mode: 'insensitive' } },
          { franchiseSku: { contains: params.search, mode: 'insensitive' } },
          { barcode: { contains: params.search, mode: 'insensitive' } },
          { product: { title: { contains: params.search, mode: 'insensitive' }, isDeleted: false } },
        ],
      });
    }

    const skip = (params.page - 1) * params.limit;

    const [mappings, total] = await this.prisma.$transaction([
      this.prisma.franchiseCatalogMapping.findMany({
        where,
        include: {
          product: {
            include: {
              category: true,
              brand: true,
              images: { where: { sortOrder: 0 }, take: 1 },
            },
          },
          variant: true,
          franchise: {
            select: {
              id: true,
              franchiseCode: true,
              businessName: true,
              ownerName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.franchiseCatalogMapping.count({ where }),
    ]);

    return { mappings, total };
  }
}
