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
import { FranchisePublicFacade } from '../../../franchise/application/facades/franchise-public.facade';

// ── Interfaces ──────────────────────────────────────────────────────────────

export type FulfillmentNodeType = 'SELLER' | 'FRANCHISE';

export interface FulfillmentNode {
  type: FulfillmentNodeType;
  id: string;
  name: string;
}

export interface LowStockItem {
  id: string;
  // Legacy fields (still set when type=SELLER, null for FRANCHISE) — kept
  // for any existing seller-only callers. New callers should use `node`.
  sellerId: string | null;
  sellerName: string | null;
  node: FulfillmentNode;
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

export type InventoryRowStatus = 'HEALTHY' | 'LOW' | 'OUT' | 'INACTIVE';

/**
 * Unified inventory row returned by the admin "all inventory" grid.
 * Same shape regardless of whether the source is a seller mapping or
 * a franchise stock row — the frontend only needs to know about
 * `node` to render the source column.
 */
export interface InventoryRow {
  id: string;
  node: FulfillmentNode;
  productId: string;
  productTitle: string;
  productCode: string | null;
  variantId: string | null;
  variantSku: string | null;
  masterSku: string | null;
  stockQty: number;
  reservedQty: number;
  availableStock: number;
  lowStockThreshold: number;
  status: InventoryRowStatus;
  isActive: boolean;
}

/**
 * Stock movement row returned by the per-mapping drill-down. Maps
 * directly to the StockMovement table — exposed read-only so the
 * admin UI can render an audit timeline.
 */
export interface MappingMovement {
  id: string;
  kind: string;
  quantityDelta: number;
  beforeStockQty: number;
  afterStockQty: number;
  beforeReservedQty: number | null;
  afterReservedQty: number | null;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  actorId: string | null;
  actorRole: string | null;
  createdAt: Date;
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
  // Where the zero-stock signal originates. SELLER means the aggregate
  // across all sellers carrying this product is 0; FRANCHISE means a
  // specific franchise's stock is 0 (carries a `node` for drill-down).
  node: FulfillmentNode;
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
    private readonly franchiseFacade: FranchisePublicFacade,
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

  /**
   * Seller-scoped overview — same shape as `getInventoryOverview` but
   * scoped to one seller's mappings only. Powers the inventory dashboard
   * on the seller portal (web-d2c-seller / web-retail-seller).
   */
  async getSellerOverview(sellerId: string): Promise<InventoryOverview> {
    const mappings = await this.repo.findActiveMappingsForSeller(sellerId);

    const distinctProducts = new Set(mappings.map((m) => m.productId)).size;
    const distinctVariants = new Set(
      mappings.filter((m) => m.variantId).map((m) => m.variantId as string),
    ).size;

    let totalStock = 0;
    let totalReserved = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    for (const m of mappings) {
      totalStock += m.stockQty;
      totalReserved += m.reservedQty;
      const available = m.stockQty - m.reservedQty;
      if (available <= 0) outOfStockCount++;
      else if (available <= m.lowStockThreshold) lowStockCount++;
    }

    return {
      totalMappedProducts: distinctProducts,
      totalMappedVariants: distinctVariants,
      totalStock,
      totalReserved,
      totalAvailable: totalStock - totalReserved,
      lowStockCount,
      outOfStockCount,
    };
  }

  /**
   * Seller-scoped out-of-stock list — mappings where available stock <= 0.
   * Mirrors `getSellerLowStock` shape so the seller portal can reuse the
   * same item renderer.
   */
  async getSellerOutOfStock(
    sellerId: string,
    page: number,
    limit: number,
  ): Promise<{ items: LowStockItem[]; total: number }> {
    const allMappings = await this.repo.findActiveMappingsForSeller(sellerId);

    const outOfStock = allMappings.filter(
      (m) => m.stockQty - m.reservedQty <= 0,
    );

    const total = outOfStock.length;
    const offset = (page - 1) * limit;
    const paged = outOfStock.slice(offset, offset + limit);

    const items: LowStockItem[] = paged.map((m) => ({
      id: m.id,
      sellerId: m.sellerId,
      sellerName: m.seller.sellerShopName || m.seller.sellerName,
      node: {
        type: 'SELLER' as const,
        id: m.sellerId,
        name: m.seller.sellerShopName || m.seller.sellerName,
      },
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
      node: {
        type: 'SELLER' as const,
        id: m.sellerId,
        name: m.seller.sellerShopName || m.seller.sellerName,
      },
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
    nodeType?: FulfillmentNodeType | 'ALL',
  ): Promise<{ items: LowStockItem[]; total: number }> {
    const wantSeller = !nodeType || nodeType === 'ALL' || nodeType === 'SELLER';
    const wantFranchise =
      !nodeType || nodeType === 'ALL' || nodeType === 'FRANCHISE';

    // sellerId filter only applies to SELLER node — kicking off both
    // queries in parallel to avoid sequential round-trips.
    const [sellerMappings, franchiseRows] = await Promise.all([
      wantSeller ? this.repo.findAllActiveMappings(sellerId) : Promise.resolve([]),
      wantFranchise && !sellerId
        ? this.franchiseFacade.findFranchiseLowStockRows()
        : Promise.resolve([]),
    ]);

    const sellerLowStock: LowStockItem[] = sellerMappings
      .filter((m) => m.stockQty - m.reservedQty <= m.lowStockThreshold)
      .map((m) => ({
        id: m.id,
        sellerId: m.sellerId,
        sellerName: m.seller.sellerShopName || m.seller.sellerName,
        node: {
          type: 'SELLER' as const,
          id: m.sellerId,
          name: m.seller.sellerShopName || m.seller.sellerName,
        },
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

    const franchiseLowStock: LowStockItem[] = franchiseRows.map((r) => ({
      id: r.id,
      sellerId: null,
      sellerName: null,
      node: { type: 'FRANCHISE' as const, id: r.franchiseId, name: r.franchiseName },
      productId: r.productId,
      productTitle: r.productTitle,
      variantId: r.variantId,
      variantSku: r.variantSku,
      masterSku: r.masterSku,
      stockQty: r.stockQty,
      reservedQty: r.reservedQty,
      availableStock: r.availableStock,
      lowStockThreshold: r.lowStockThreshold,
      isActive: true,
    }));

    // Merge + sort: most-urgent (smallest availableStock) first so the
    // first page is always the rows the admin needs to act on.
    const all = [...sellerLowStock, ...franchiseLowStock].sort(
      (a, b) => a.availableStock - b.availableStock,
    );

    const total = all.length;
    const offset = (page - 1) * limit;
    const paged = all.slice(offset, offset + limit);

    return { items: paged, total };
  }

  // ── T4: Out-of-stock products ───────────────────────────────────────

  async getOutOfStockProducts(
    page: number,
    limit: number,
    nodeType?: FulfillmentNodeType | 'ALL',
  ): Promise<{ items: OutOfStockProduct[]; total: number }> {
    const wantSeller = !nodeType || nodeType === 'ALL' || nodeType === 'SELLER';
    const wantFranchise =
      !nodeType || nodeType === 'ALL' || nodeType === 'FRANCHISE';

    const [sellerMappings, franchiseRows] = await Promise.all([
      wantSeller
        ? this.repo.findActiveMappingsForAggregation()
        : Promise.resolve([]),
      wantFranchise
        ? this.franchiseFacade.findFranchiseOutOfStockRows()
        : Promise.resolve([]),
    ]);

    // Seller side aggregates across all sellers carrying the same
    // (product,variant) — out-of-stock at the platform level means
    // nobody has stock to fulfil a new order. The synthesised node
    // says "platform-wide" since multiple sellers are summed.
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

    for (const m of sellerMappings) {
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

    const sellerOutOfStock: OutOfStockProduct[] = Array.from(aggregated.values())
      .filter((item) => item.totalStock - item.totalReserved <= 0)
      .map((item) => ({
        ...item,
        node: {
          type: 'SELLER' as const,
          id: 'aggregate',
          name:
            item.sellerCount === 0
              ? 'No sellers'
              : `${item.sellerCount} seller${item.sellerCount === 1 ? '' : 's'}`,
        },
      }));

    // Franchise side stays per-row — each franchise's empty stock
    // is its own actionable signal (one franchise being empty doesn't
    // mean another is, so we don't aggregate across franchises).
    const franchiseOutOfStock: OutOfStockProduct[] = franchiseRows.map((r) => ({
      productId: r.productId,
      productTitle: r.productTitle,
      productCode: r.productCode,
      hasVariants: r.hasVariants,
      variantId: r.variantId,
      variantSku: r.variantSku,
      totalStock: r.totalStock,
      totalReserved: r.totalReserved,
      sellerCount: 0,
      node: { type: 'FRANCHISE' as const, id: r.franchiseId, name: r.franchiseName },
    }));

    const all = [...sellerOutOfStock, ...franchiseOutOfStock];

    const total = all.length;
    const offset = (page - 1) * limit;
    const paged = all.slice(offset, offset + limit);

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
      franchiseStats,
    ] = await Promise.all([
      this.repo.countDistinctMappedProducts(),
      this.repo.countDistinctMappedVariants(),
      this.repo.aggregateActiveStock(),
      this.repo.findAllActiveMappingStockInfo(),
      this.franchiseFacade.getFranchiseInventoryStats(),
    ]);

    const sellerLowStockCount = allActive.filter(
      (m) =>
        m.stockQty - m.reservedQty <= m.lowStockThreshold &&
        m.stockQty - m.reservedQty > 0,
    ).length;

    const sellerOutOfStockCount = allActive.filter(
      (m) => m.stockQty - m.reservedQty <= 0,
    ).length;

    // Numbers are platform-wide unions: sellers PLUS franchises. Two
    // sellers carrying the same SKU still count twice in totalStock
    // (matches existing seller behaviour) — totalMappedProducts uses
    // a union-of-distinct-IDs approach so adding franchises doesn't
    // double-count items both networks happen to carry.
    return {
      totalMappedProducts: totalMappedProducts + franchiseStats.distinctProducts,
      totalMappedVariants: totalMappedVariants + franchiseStats.distinctVariants,
      totalStock: stockAgg.totalStockQty + franchiseStats.totalStock,
      totalReserved: stockAgg.totalReservedQty + franchiseStats.totalReserved,
      totalAvailable:
        stockAgg.totalStockQty -
        stockAgg.totalReservedQty +
        (franchiseStats.totalStock - franchiseStats.totalReserved),
      lowStockCount: sellerLowStockCount + franchiseStats.lowStockCount,
      outOfStockCount: sellerOutOfStockCount + franchiseStats.outOfStockCount,
    };
  }

  // ── T8: Unified admin inventory grid ───────────────────────────────
  // One paginated, searchable view across seller mappings + franchise
  // stock. Used by the redesigned admin Inventory page so the user can
  // browse "everything currently in stock" rather than just low/out.

  async getAdminAllInventory(opts: {
    page: number;
    limit: number;
    search?: string;
    sellerId?: string;
    nodeType?: FulfillmentNodeType | 'ALL';
    status?: InventoryRowStatus | 'ALL';
  }): Promise<{ items: InventoryRow[]; total: number }> {
    const {
      page,
      limit,
      search,
      sellerId,
      nodeType = 'ALL',
      status = 'ALL',
    } = opts;

    const wantSeller = nodeType === 'ALL' || nodeType === 'SELLER';
    const wantFranchise = nodeType === 'ALL' || nodeType === 'FRANCHISE';

    const [sellerMappings, franchiseRows] = await Promise.all([
      wantSeller ? this.repo.findAllActiveMappings(sellerId) : Promise.resolve([]),
      wantFranchise && !sellerId
        ? this.franchiseFacade.findAllFranchiseRows()
        : Promise.resolve([]),
    ]);

    const classify = (
      available: number,
      threshold: number,
      isActive: boolean,
    ): InventoryRowStatus => {
      if (!isActive) return 'INACTIVE';
      if (available <= 0) return 'OUT';
      if (available <= threshold) return 'LOW';
      return 'HEALTHY';
    };

    const sellerRows: InventoryRow[] = sellerMappings.map((m) => {
      const available = m.stockQty - m.reservedQty;
      return {
        id: m.id,
        node: {
          type: 'SELLER',
          id: m.sellerId,
          name: m.seller.sellerShopName || m.seller.sellerName,
        },
        productId: m.productId,
        productTitle: m.product.title,
        productCode: m.product.productCode,
        variantId: m.variantId,
        variantSku: m.variant?.sku ?? null,
        masterSku: m.variant?.masterSku ?? null,
        stockQty: m.stockQty,
        reservedQty: m.reservedQty,
        availableStock: available,
        lowStockThreshold: m.lowStockThreshold,
        status: classify(available, m.lowStockThreshold, m.isActive),
        isActive: m.isActive,
      };
    });

    const franchiseInventoryRows: InventoryRow[] = franchiseRows.map((r) => {
      const isActive = r.franchiseStatus === 'ACTIVE';
      return {
        id: r.id,
        node: { type: 'FRANCHISE', id: r.franchiseId, name: r.franchiseName },
        productId: r.productId,
        productTitle: r.productTitle,
        productCode: null,
        variantId: r.variantId,
        variantSku: r.variantSku,
        masterSku: r.masterSku,
        stockQty: r.stockQty,
        reservedQty: r.reservedQty,
        availableStock: r.availableStock,
        lowStockThreshold: r.lowStockThreshold,
        status: classify(r.availableStock, r.lowStockThreshold, isActive),
        isActive,
      };
    });

    let all = [...sellerRows, ...franchiseInventoryRows];

    // Search filter — case-insensitive over title, SKUs, node name.
    if (search) {
      const q = search.trim().toLowerCase();
      if (q) {
        all = all.filter((r) =>
          r.productTitle.toLowerCase().includes(q) ||
          (r.masterSku ?? '').toLowerCase().includes(q) ||
          (r.variantSku ?? '').toLowerCase().includes(q) ||
          (r.productCode ?? '').toLowerCase().includes(q) ||
          r.node.name.toLowerCase().includes(q),
        );
      }
    }

    if (status !== 'ALL') {
      all = all.filter((r) => r.status === status);
    }

    // Sort: urgent first (OUT, LOW), then healthy by lowest available,
    // inactive last. Within each bucket, lowest available stock first.
    const statusRank: Record<InventoryRowStatus, number> = {
      OUT: 0,
      LOW: 1,
      HEALTHY: 2,
      INACTIVE: 3,
    };
    all.sort((a, b) => {
      const sr = statusRank[a.status] - statusRank[b.status];
      if (sr !== 0) return sr;
      return a.availableStock - b.availableStock;
    });

    const total = all.length;
    const offset = (page - 1) * limit;
    const paged = all.slice(offset, offset + limit);

    return { items: paged, total };
  }

  // ── T9: Per-mapping stock movement timeline ─────────────────────────
  // Read-only audit trail for a single seller_product_mapping. Used by
  // the admin inventory drill-down side panel to show what happened
  // to a SKU's stock over time.

  async getMappingMovements(
    mappingId: string,
    page: number,
    limit: number,
  ): Promise<{ movements: MappingMovement[]; total: number }> {
    const mapping = await this.repo.findMappingById(mappingId);
    if (!mapping) {
      throw new NotFoundAppException(`Mapping ${mappingId} not found`);
    }
    const result = await this.repo.findMovementsByMappingId(
      mappingId,
      page,
      limit,
    );
    return {
      movements: result.movements,
      total: result.total,
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
