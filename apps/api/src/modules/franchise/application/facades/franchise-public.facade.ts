import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';
import {
  FranchiseCatalogRepository,
  FRANCHISE_CATALOG_REPOSITORY,
} from '../../domain/repositories/franchise-catalog.repository.interface';
import { FranchiseInventoryService } from '../services/franchise-inventory.service';
import { FranchiseOrdersService } from '../services/franchise-orders.service';
import { FranchiseCommissionService } from '../services/franchise-commission.service';

@Injectable()
export class FranchisePublicFacade {
  private readonly logger = new Logger(FranchisePublicFacade.name);

  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    @Inject(FRANCHISE_CATALOG_REPOSITORY)
    private readonly catalogRepo: FranchiseCatalogRepository,
    private readonly inventoryService: FranchiseInventoryService,
    private readonly ordersService: FranchiseOrdersService,
    private readonly commissionService: FranchiseCommissionService,
    private readonly prisma: PrismaService,
  ) {}

  async getFranchisePartnerState(franchiseId: string) {
    const franchise = await this.franchiseRepo.findById(franchiseId);
    if (!franchise) return null;
    return {
      id: franchise.id,
      status: franchise.status,
      verificationStatus: franchise.verificationStatus,
    };
  }

  async isFranchiseActive(franchiseId: string): Promise<boolean> {
    const franchise = await this.franchiseRepo.findById(franchiseId);
    return franchise?.status === 'ACTIVE';
  }

  /**
   * Check if a franchise has a specific product mapped in its catalog.
   */
  async getFranchiseCatalogMappings(franchiseId: string, productId: string) {
    const result = await this.catalogRepo.findByFranchiseAndProduct(
      franchiseId,
      productId,
      null,
    );
    return result;
  }

  async computeFranchiseFeeApplicability(_params: {
    pincode: string;
    orderValue: number;
  }) {
    return null;
  }

  /**
   * Get available stock for a product at a franchise (used by routing engine).
   */
  async getAvailableStock(
    franchiseId: string,
    productId: string,
    variantId: string | null,
  ): Promise<number> {
    return this.inventoryService.getAvailableStock(
      franchiseId,
      productId,
      variantId,
    );
  }

  /**
   * Reserve stock at a franchise for checkout.
   */
  async reserveStock(
    franchiseId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
    orderId?: string,
  ) {
    return this.inventoryService.reserveStock(
      franchiseId,
      productId,
      variantId,
      quantity,
      orderId,
    );
  }

  /**
   * Unreserve stock at a franchise (cancellation).
   */
  async unreserveStock(
    franchiseId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
    orderId?: string,
  ) {
    return this.inventoryService.unreserveStock(
      franchiseId,
      productId,
      variantId,
      quantity,
      orderId,
    );
  }

  /**
   * List orders assigned to a franchise (for cross-module access).
   */
  async listFranchiseOrders(
    franchiseId: string,
    page: number,
    limit: number,
  ) {
    return this.ordersService.listOrders(franchiseId, page, limit);
  }

  /**
   * Record online order commission for a franchise-fulfilled order.
   * Called by the commission processor after delivery + return window passes.
   */
  async recordOnlineOrderCommission(params: {
    franchiseId: string;
    subOrderId: string;
    orderNumber: string;
    items: Array<{ unitPrice: number; quantity: number }>;
    commissionRate: number;
  }) {
    return this.commissionService.recordOnlineOrderCommission(params);
  }

  /**
   * Get earnings summary for franchise dashboard KPIs.
   */
  async getEarningsSummary(franchiseId: string) {
    return this.commissionService.getEarningsSummary(franchiseId);
  }

  /**
   * Get the current online fulfillment commission rate for a franchise.
   * Used by checkout to snapshot the rate at order placement time.
   */
  async getCommissionRate(franchiseId: string): Promise<number | null> {
    const franchise = await this.franchiseRepo.findById(franchiseId);
    if (!franchise) return null;
    return Number(franchise.onlineFulfillmentRate);
  }

  /**
   * Return QC-approved stock to the franchise's on-hand quantity via
   * ORDER_RETURN ledger movement.
   */
  async recordReturn(
    franchiseId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
    orderId: string,
  ): Promise<void> {
    await this.inventoryService.recordReturn(
      franchiseId,
      productId,
      variantId,
      quantity,
      orderId,
    );
  }

  /**
   * Mark returned stock as damaged at the franchise — moves to damagedQty via
   * a DAMAGE adjustment (deducts from onHand and adds to damagedQty).
   */
  async recordDamagedReturn(
    franchiseId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
    orderId: string,
    actorId: string,
  ): Promise<void> {
    await this.inventoryService.adjustStock(franchiseId, {
      productId,
      variantId: variantId ?? undefined,
      adjustmentType: 'DAMAGE',
      quantity,
      reason: `Damaged return for order ${orderId}`,
      actorType: 'SYSTEM',
      actorId,
    });
  }

  /**
   * Reverse franchise commission for a returned sub-order. Finds the original
   * ONLINE_ORDER ledger entry and creates a RETURN_REVERSAL entry against it.
   */
  async recordReturnReversal(params: {
    franchiseId: string;
    subOrderId: string;
    reversalAmount: number;
  }): Promise<void> {
    // Locate the original online-order ledger entry for this sub-order.
    // If none exists yet (e.g. return happened before the 7-day commission
    // lock processor fired), we still record a standalone reversal entry so
    // the ledger never misses a refund — the caller is shielded from having
    // to know about this edge case.
    const originalEntry = await this.prisma.franchiseFinanceLedger.findFirst({
      where: {
        franchiseId: params.franchiseId,
        sourceId: params.subOrderId,
        sourceType: 'ONLINE_ORDER',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!originalEntry) {
      // Not an error — can happen when return lands before commission lock.
      // The reversal is still recorded so settlement math stays correct.
      // Logged at warn so operators can spot unusual patterns.
      this.logger.warn(
        `No ONLINE_ORDER ledger entry for subOrder ${params.subOrderId} — creating standalone reversal for ₹${params.reversalAmount}`,
      );
    }

    await this.commissionService.recordReturnReversal({
      franchiseId: params.franchiseId,
      originalLedgerEntryId: originalEntry?.id ?? '',
      subOrderId: params.subOrderId,
      reversalAmount: params.reversalAmount,
    });
  }

  // ── Admin-side inventory readers ───────────────────────────
  // Used by the unified Inventory Overview page so a single admin
  // surface can show both seller and franchise stock with one
  // mental model. The shape mirrors InventoryManagementService's
  // LowStockItem so the inventory service can map across.

  async findFranchiseLowStockRows(): Promise<
    Array<{
      id: string;
      franchiseId: string;
      franchiseName: string;
      productId: string;
      productTitle: string;
      variantId: string | null;
      variantSku: string | null;
      masterSku: string | null;
      stockQty: number;
      reservedQty: number;
      availableStock: number;
      lowStockThreshold: number;
    }>
  > {
    // FranchiseStock only has a `franchise` relation in the schema
    // (no `product` / `variant` relations), so we look those up
    // separately and join in memory. Cheaper than the alternative
    // (adding cross-module relations into the schema).
    const rows = await this.prisma.franchiseStock.findMany({
      where: {
        franchise: { status: 'ACTIVE' },
        availableQty: { gt: 0 },
      },
      include: { franchise: { select: { id: true, businessName: true } } },
    });
    const lowRows = rows.filter((r) => r.availableQty <= r.lowStockThreshold);
    if (lowRows.length === 0) return [];

    const productIds = Array.from(new Set(lowRows.map((r) => r.productId)));
    const variantIds = Array.from(
      new Set(lowRows.map((r) => r.variantId).filter(Boolean) as string[]),
    );
    const [products, variants] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, title: true },
      }),
      variantIds.length
        ? this.prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, sku: true, masterSku: true },
          })
        : Promise.resolve([]),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const variantById = new Map(variants.map((v) => [v.id, v]));

    return lowRows.map((r) => ({
      id: r.id,
      franchiseId: r.franchiseId,
      franchiseName: r.franchise.businessName,
      productId: r.productId,
      productTitle: productById.get(r.productId)?.title ?? '(unknown product)',
      variantId: r.variantId,
      variantSku: r.variantId ? variantById.get(r.variantId)?.sku ?? null : null,
      masterSku: r.variantId
        ? variantById.get(r.variantId)?.masterSku ?? null
        : null,
      stockQty: r.onHandQty,
      reservedQty: r.reservedQty,
      availableStock: r.availableQty,
      lowStockThreshold: r.lowStockThreshold,
    }));
  }

  async findFranchiseOutOfStockRows(): Promise<
    Array<{
      productId: string;
      productTitle: string;
      productCode: string;
      hasVariants: boolean;
      variantId: string | null;
      variantSku: string | null;
      franchiseId: string;
      franchiseName: string;
      totalStock: number;
      totalReserved: number;
    }>
  > {
    const rows = await this.prisma.franchiseStock.findMany({
      where: {
        franchise: { status: 'ACTIVE' },
        availableQty: { lte: 0 },
      },
      include: { franchise: { select: { id: true, businessName: true } } },
    });
    if (rows.length === 0) return [];

    const productIds = Array.from(new Set(rows.map((r) => r.productId)));
    const variantIds = Array.from(
      new Set(rows.map((r) => r.variantId).filter(Boolean) as string[]),
    );
    const [products, variants] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        // Product schema uses `productCode` and `hasVariants` columns —
        // keep both available for downstream consumers.
        select: {
          id: true,
          title: true,
          productCode: true,
          hasVariants: true,
        },
      }),
      variantIds.length
        ? this.prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, sku: true },
          })
        : Promise.resolve([]),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const variantById = new Map(variants.map((v) => [v.id, v]));

    return rows.map((r) => {
      const product = productById.get(r.productId);
      return {
        productId: r.productId,
        productTitle: product?.title ?? '(unknown product)',
        productCode: product?.productCode ?? '',
        hasVariants: product?.hasVariants ?? false,
        variantId: r.variantId,
        variantSku: r.variantId
          ? variantById.get(r.variantId)?.sku ?? null
          : null,
        franchiseId: r.franchiseId,
        franchiseName: r.franchise.businessName,
        totalStock: r.onHandQty,
        totalReserved: r.reservedQty,
      };
    });
  }

  async getFranchiseInventoryStats(): Promise<{
    distinctProducts: number;
    distinctVariants: number;
    totalStock: number;
    totalReserved: number;
    lowStockCount: number;
    outOfStockCount: number;
  }> {
    const rows = await this.prisma.franchiseStock.findMany({
      where: { franchise: { status: 'ACTIVE' } },
      select: {
        productId: true,
        variantId: true,
        onHandQty: true,
        reservedQty: true,
        availableQty: true,
        lowStockThreshold: true,
      },
    });
    const productIds = new Set(rows.map((r) => r.productId));
    const variantIds = new Set(
      rows.filter((r) => r.variantId).map((r) => r.variantId as string),
    );
    let totalStock = 0;
    let totalReserved = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    for (const r of rows) {
      totalStock += r.onHandQty;
      totalReserved += r.reservedQty;
      if (r.availableQty <= 0) outOfStockCount += 1;
      else if (r.availableQty <= r.lowStockThreshold) lowStockCount += 1;
    }
    return {
      distinctProducts: productIds.size,
      distinctVariants: variantIds.size,
      totalStock,
      totalReserved,
      lowStockCount,
      outOfStockCount,
    };
  }
}
