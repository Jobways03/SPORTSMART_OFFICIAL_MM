import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BadRequestAppException,
  NotFoundAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';
import {
  InventoryManagementRepository,
  INVENTORY_MANAGEMENT_REPOSITORY,
} from '../../domain/repositories/inventory-management.repository.interface';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface LowStockItem {
  id: string;
  sellerId: string;
  sellerName: string;
  productId: string;
  productTitle: string;
  variantId: string | null;
  variantSku: string | null;
  masterSku: string | null;
  stockQty: number;
  reservedQty: number;
  availableStock: number;
  lowStockThreshold: number;
  isActive: boolean;
}

export interface OutOfStockProduct {
  productId: string;
  productTitle: string;
  productCode: string;
  hasVariants: boolean;
  variantId: string | null;
  variantSku: string | null;
  totalStock: number;
  totalReserved: number;
  sellerCount: number;
}

export interface InventoryOverview {
  totalMappedProducts: number;
  totalMappedVariants: number;
  totalStock: number;
  totalReserved: number;
  totalAvailable: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface StockImportItem {
  masterSku: string;
  stockQty: number;
}

// ── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class InventoryManagementService {
  private readonly logger = new Logger(InventoryManagementService.name);

  constructor(
    @Inject(INVENTORY_MANAGEMENT_REPOSITORY)
    private readonly repo: InventoryManagementRepository,
  ) {}

  // ── T2: Manual stock adjustment ─────────────────────────────────────

  async adjustStock(
    mappingId: string,
    adjustment: number,
    sellerId?: string,
  ): Promise<{
    id: string;
    stockQty: number;
    reservedQty: number;
    availableStock: number;
  }> {
    if (adjustment === 0) {
      throw new BadRequestAppException('Adjustment must be non-zero');
    }
    if (!Number.isInteger(adjustment)) {
      throw new BadRequestAppException('Adjustment must be an integer');
    }

    const mapping = await this.repo.findMappingById(mappingId);

    if (!mapping) {
      throw new NotFoundAppException(`Mapping ${mappingId} not found`);
    }

    // If sellerId provided, verify ownership
    if (sellerId && mapping.sellerId !== sellerId) {
      throw new ForbiddenAppException(
        'You do not have permission to adjust stock for this mapping',
      );
    }

    const newStockQty = mapping.stockQty + adjustment;
    if (newStockQty < 0) {
      throw new BadRequestAppException(
        `Cannot reduce stock below 0. Current stock: ${mapping.stockQty}, adjustment: ${adjustment}`,
      );
    }

    // Ensure available stock doesn't go negative
    if (newStockQty < mapping.reservedQty) {
      throw new BadRequestAppException(
        `Cannot reduce stock below reserved quantity. Current reserved: ${mapping.reservedQty}, resulting stock: ${newStockQty}`,
      );
    }

    const updated = await this.repo.updateMappingStock(mappingId, newStockQty);

    this.logger.log(
      `Stock adjusted for mapping ${mappingId}: ${adjustment > 0 ? '+' : ''}${adjustment} → stockQty=${updated.stockQty}`,
    );

    return {
      id: updated.id,
      stockQty: updated.stockQty,
      reservedQty: updated.reservedQty,
      availableStock: updated.stockQty - updated.reservedQty,
    };
  }

  // ── T3: Low stock queries ───────────────────────────────────────────

  async getSellerLowStock(
    sellerId: string,
    page: number,
    limit: number,
  ): Promise<{ items: LowStockItem[]; total: number }> {
    const allMappings = await this.repo.findActiveMappingsForSeller(sellerId);

    // Filter: available stock <= threshold
    const lowStock = allMappings.filter(
      (m) => (m.stockQty - m.reservedQty) <= m.lowStockThreshold,
    );

    const total = lowStock.length;
    const offset = (page - 1) * limit;
    const paged = lowStock.slice(offset, offset + limit);

    const items: LowStockItem[] = paged.map((m) => ({
      id: m.id,
      sellerId: m.sellerId,
      sellerName: m.seller.sellerShopName || m.seller.sellerName,
      productId: m.productId,
      productTitle: m.product.title,
      variantId: m.variantId,
      variantSku: m.variant?.sku ?? null,
      masterSku: m.variant?.masterSku ?? null,
      stockQty: m.stockQty,
      reservedQty: m.reservedQty,
      availableStock: m.stockQty - m.reservedQty,
      lowStockThreshold: m.lowStockThreshold,
      isActive: m.isActive,
    }));

    return { items, total };
  }

  async getAdminLowStock(
    page: number,
    limit: number,
    sellerId?: string,
  ): Promise<{ items: LowStockItem[]; total: number }> {
    const allMappings = await this.repo.findAllActiveMappings(sellerId);

    const lowStock = allMappings.filter(
      (m) => (m.stockQty - m.reservedQty) <= m.lowStockThreshold,
    );

    const total = lowStock.length;
    const offset = (page - 1) * limit;
    const paged = lowStock.slice(offset, offset + limit);

    const items: LowStockItem[] = paged.map((m) => ({
      id: m.id,
      sellerId: m.sellerId,
      sellerName: m.seller.sellerShopName || m.seller.sellerName,
      productId: m.productId,
      productTitle: m.product.title,
      variantId: m.variantId,
      variantSku: m.variant?.sku ?? null,
      masterSku: m.variant?.masterSku ?? null,
      stockQty: m.stockQty,
      reservedQty: m.reservedQty,
      availableStock: m.stockQty - m.reservedQty,
      lowStockThreshold: m.lowStockThreshold,
      isActive: m.isActive,
    }));

    return { items, total };
  }

  // ── T4: Out-of-stock products ───────────────────────────────────────

  async getOutOfStockProducts(
    page: number,
    limit: number,
  ): Promise<{ items: OutOfStockProduct[]; total: number }> {
    const mappings = await this.repo.findActiveMappingsForAggregation();

    // Aggregate by productId + variantId
    const aggregated = new Map<
      string,
      {
        productId: string;
        productTitle: string;
        productCode: string;
        hasVariants: boolean;
        variantId: string | null;
        variantSku: string | null;
        totalStock: number;
        totalReserved: number;
        sellerCount: number;
      }
    >();

    for (const m of mappings) {
      const key = `${m.productId}::${m.variantId ?? 'null'}`;
      const existing = aggregated.get(key);
      if (existing) {
        existing.totalStock += m.stockQty;
        existing.totalReserved += m.reservedQty;
        existing.sellerCount += 1;
      } else {
        aggregated.set(key, {
          productId: m.productId,
          productTitle: m.product.title,
          productCode: m.product.productCode ?? '',
          hasVariants: m.product.hasVariants,
          variantId: m.variantId,
          variantSku: m.variant?.sku ?? null,
          totalStock: m.stockQty,
          totalReserved: m.reservedQty,
          sellerCount: 1,
        });
      }
    }

    // Filter to out-of-stock (totalStock - totalReserved <= 0)
    const outOfStock = Array.from(aggregated.values()).filter(
      (item) => item.totalStock - item.totalReserved <= 0,
    );

    const total = outOfStock.length;
    const offset = (page - 1) * limit;
    const paged = outOfStock.slice(offset, offset + limit);

    return { items: paged, total };
  }

  // ── T5: Stock import by masterSku ───────────────────────────────────

  async importStockBySku(
    sellerId: string,
    items: StockImportItem[],
  ): Promise<{
    updated: number;
    skipped: { masterSku: string; reason: string }[];
  }> {
    if (!items || items.length === 0) {
      throw new BadRequestAppException('Items array must not be empty');
    }
    if (items.length > 500) {
      throw new BadRequestAppException('Maximum 500 items per import');
    }

    // Validate all items
    for (const item of items) {
      if (!item.masterSku) {
        throw new BadRequestAppException('Each item must have a masterSku');
      }
      if (item.stockQty === undefined || item.stockQty === null) {
        throw new BadRequestAppException(
          `stockQty is required for masterSku ${item.masterSku}`,
        );
      }
      if (item.stockQty < 0) {
        throw new BadRequestAppException(
          `stockQty must be >= 0 for masterSku ${item.masterSku}`,
        );
      }
    }

    // Look up all master SKUs for this seller
    const skus = items.map((i) => i.masterSku);

    // Find variants by masterSku
    const variants = await this.repo.findVariantsByMasterSkus(skus);

    // Also check if masterSku matches a productCode (for simple products)
    const products = await this.repo.findProductsByProductCodes(skus);

    // Build a map: masterSku -> { productId, variantId }
    const skuMap = new Map<string, { productId: string; variantId: string | null }>();

    for (const v of variants) {
      if (v.masterSku) {
        skuMap.set(v.masterSku, { productId: v.productId, variantId: v.id });
      }
    }

    for (const p of products) {
      if (p.productCode && !skuMap.has(p.productCode)) {
        skuMap.set(p.productCode, { productId: p.id, variantId: null });
      }
    }

    let updated = 0;
    const skipped: { masterSku: string; reason: string }[] = [];

    for (const item of items) {
      const target = skuMap.get(item.masterSku);
      if (!target) {
        skipped.push({ masterSku: item.masterSku, reason: 'SKU not found in catalog' });
        continue;
      }

      // Find seller's mapping for this product/variant
      const mapping = await this.repo.findSellerMappingByProductVariant(
        sellerId,
        target.productId,
        target.variantId,
      );

      if (!mapping) {
        skipped.push({
          masterSku: item.masterSku,
          reason: 'No seller mapping found for this SKU',
        });
        continue;
      }

      await this.repo.setMappingStockQty(mapping.id, item.stockQty);
      updated++;
    }

    this.logger.log(
      `Stock import for seller ${sellerId}: ${updated} updated, ${skipped.length} skipped`,
    );

    return { updated, skipped };
  }

  // ── T6: Admin inventory overview ────────────────────────────────────

  async getInventoryOverview(): Promise<InventoryOverview> {
    const [
      totalMappedProducts,
      totalMappedVariants,
      stockAgg,
      allActive,
    ] = await Promise.all([
      this.repo.countDistinctMappedProducts(),
      this.repo.countDistinctMappedVariants(),
      this.repo.aggregateActiveStock(),
      this.repo.findAllActiveMappingStockInfo(),
    ]);

    const totalStock = stockAgg.totalStockQty;
    const totalReserved = stockAgg.totalReservedQty;

    const lowStockCount = allActive.filter(
      (m) => (m.stockQty - m.reservedQty) <= m.lowStockThreshold && (m.stockQty - m.reservedQty) > 0,
    ).length;

    const outOfStockCount = allActive.filter(
      (m) => (m.stockQty - m.reservedQty) <= 0,
    ).length;

    return {
      totalMappedProducts,
      totalMappedVariants,
      totalStock,
      totalReserved,
      totalAvailable: totalStock - totalReserved,
      lowStockCount,
      outOfStockCount,
    };
  }

  // ── T7: Active reservations list ────────────────────────────────────

  async getActiveReservations(
    page: number,
    limit: number,
    filters?: { mappingId?: string; orderId?: string },
  ): Promise<{
    reservations: any[];
    total: number;
  }> {
    const result = await this.repo.findActiveReservations(page, limit, filters);

    return {
      reservations: result.reservations.map((r) => ({
        id: r.id,
        mappingId: r.mappingId,
        quantity: r.quantity,
        status: r.status,
        orderId: r.orderId,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
        seller: {
          id: r.mapping.seller.id,
          name: r.mapping.seller.sellerShopName || r.mapping.seller.sellerName,
        },
        product: {
          id: r.mapping.product.id,
          title: r.mapping.product.title,
          code: r.mapping.product.productCode,
        },
        variant: r.mapping.variant
          ? {
              id: r.mapping.variant.id,
              sku: r.mapping.variant.sku,
              masterSku: r.mapping.variant.masterSku,
            }
          : null,
      })),
      total: result.total,
    };
  }
}
