import { Injectable, Inject } from '@nestjs/common';
import {
  FranchiseCatalogRepository,
  FRANCHISE_CATALOG_REPOSITORY,
} from '../../domain/repositories/franchise-catalog.repository.interface';
import {
  NotFoundAppException,
  ConflictAppException,
  BadRequestAppException,
} from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * FranchiseCatalogService — the only place the franchise module may touch the
 * `Product` / `ProductVariant` tables. Access is strictly READ-ONLY
 * (`findFirst` / `findUnique` / `findMany`).
 *
 * Writes to product/variant tables belong exclusively to the seller stack.
 * Do NOT introduce prisma.product.{create,update,delete,upsert} or
 * prisma.productVariant.{create,update,delete,upsert} in this module.
 */
@Injectable()
export class FranchiseCatalogService {
  constructor(
    @Inject(FRANCHISE_CATALOG_REPOSITORY)
    private readonly catalogRepo: FranchiseCatalogRepository,
    private readonly prisma: PrismaService,
  ) {}

  async browseAvailableProducts(params: {
    page: number;
    limit: number;
    search?: string;
    categoryId?: string;
    brandId?: string;
    excludeFranchiseId?: string;
  }) {
    return this.catalogRepo.findAvailableProducts(params);
  }

  async listMappings(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      search?: string;
      isActive?: boolean;
      approvalStatus?: string;
    },
  ) {
    return this.catalogRepo.findByFranchiseId(franchiseId, params);
  }

  async addMapping(
    franchiseId: string,
    data: {
      productId: string;
      variantId?: string;
      globalSku: string;
      franchiseSku?: string;
      barcode?: string;
      isListedForOnlineFulfillment?: boolean;
    },
  ) {
    // Validate product exists and is ACTIVE
    const product = await this.prisma.product.findFirst({
      where: { id: data.productId, isDeleted: false },
      select: { id: true, status: true },
    });
    if (!product) {
      throw new NotFoundAppException('Product not found');
    }
    if (product.status !== 'ACTIVE') {
      throw new BadRequestAppException('Can only map products with ACTIVE status');
    }

    // If a variant is specified, it must exist and belong to the same product
    await this.assertVariantBelongsToProduct(data.productId, data.variantId);

    // Resolve globalSku from product/variant if not provided
    let globalSku = data.globalSku;
    if (!globalSku) {
      globalSku = await this.resolveGlobalSku(data.productId, data.variantId);
    }

    try {
      return await this.catalogRepo.create({
        franchiseId,
        ...data,
        globalSku,
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictAppException(
          'This product/variant is already mapped for this franchise',
        );
      }
      throw error;
    }
  }

  async addMappings(
    franchiseId: string,
    mappings: Array<{
      productId: string;
      variantId?: string;
      globalSku: string;
      franchiseSku?: string;
      barcode?: string;
    }>,
  ) {
    // Validate all products exist and are ACTIVE before creating any mappings
    const productIds = [...new Set(mappings.map((m) => m.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, isDeleted: false },
      select: { id: true, status: true },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));
    for (const pid of productIds) {
      const product = productMap.get(pid);
      if (!product) {
        throw new NotFoundAppException(`Product ${pid} not found`);
      }
      if (product.status !== 'ACTIVE') {
        throw new BadRequestAppException(
          `Product ${pid} is not ACTIVE. Can only map products with ACTIVE status`,
        );
      }
    }

    // Validate every variantId belongs to its stated product
    await Promise.all(
      mappings.map((m) => this.assertVariantBelongsToProduct(m.productId, m.variantId)),
    );

    // Resolve globalSku for each mapping
    const resolved = await Promise.all(
      mappings.map(async (m) => {
        let globalSku = m.globalSku;
        if (!globalSku) {
          globalSku = await this.resolveGlobalSku(m.productId, m.variantId);
        }
        return { franchiseId, ...m, globalSku };
      }),
    );

    return this.catalogRepo.createMany(resolved);
  }

  async updateMapping(
    franchiseId: string,
    mappingId: string,
    data: {
      franchiseSku?: string;
      barcode?: string;
      isListedForOnlineFulfillment?: boolean;
    },
  ) {
    const mapping = await this.catalogRepo.findById(mappingId);
    if (!mapping) {
      throw new NotFoundAppException('Catalog mapping not found');
    }
    if (mapping.franchiseId !== franchiseId) {
      throw new NotFoundAppException('Catalog mapping not found');
    }

    return this.catalogRepo.update(mappingId, data);
  }

  async removeMapping(franchiseId: string, mappingId: string) {
    const mapping = await this.catalogRepo.findById(mappingId);
    if (!mapping) {
      throw new NotFoundAppException('Catalog mapping not found');
    }
    if (mapping.franchiseId !== franchiseId) {
      throw new NotFoundAppException('Catalog mapping not found');
    }

    await this.catalogRepo.delete(mappingId);
  }

  async getMapping(franchiseId: string, mappingId: string) {
    const mapping = await this.catalogRepo.findById(mappingId);
    if (!mapping) {
      throw new NotFoundAppException('Catalog mapping not found');
    }
    if (mapping.franchiseId !== franchiseId) {
      throw new NotFoundAppException('Catalog mapping not found');
    }

    return mapping;
  }

  /**
   * Guard: when a franchise specifies a variantId, it MUST belong to the
   * product they also specified. Prevents constructing a mapping with a
   * valid variant from a different product's catalog.
   */
  private async assertVariantBelongsToProduct(
    productId: string,
    variantId: string | undefined,
  ): Promise<void> {
    if (!variantId) return;
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, productId: true },
    });
    if (!variant) {
      throw new NotFoundAppException(`Variant ${variantId} not found`);
    }
    if (variant.productId !== productId) {
      throw new BadRequestAppException(
        `Variant ${variantId} does not belong to product ${productId}`,
      );
    }
  }

  /**
   * Resolve the global SKU from the product or variant.
   * If variantId is provided, use variant.sku or variant.masterSku.
   * Otherwise, use product.baseSku or product.productCode.
   */
  private async resolveGlobalSku(
    productId: string,
    variantId?: string,
  ): Promise<string> {
    if (variantId) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { sku: true, masterSku: true },
      });
      if (variant) {
        const sku = variant.masterSku || variant.sku;
        if (!sku) {
          throw new BadRequestAppException(
            `Product variant ${variantId} has no SKU assigned. Cannot create catalog mapping without a valid SKU.`,
          );
        }
        return sku;
      }
    }

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { baseSku: true, productCode: true },
    });

    const globalSku = product?.baseSku || product?.productCode;
    if (!globalSku) {
      throw new BadRequestAppException(
        `Product ${productId} has no SKU assigned. Cannot create catalog mapping without a valid SKU.`,
      );
    }
    return globalSku;
  }
}
