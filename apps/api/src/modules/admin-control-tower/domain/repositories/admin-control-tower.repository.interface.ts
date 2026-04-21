/* ── Admin Control Tower Repository Interface ────────────────────────
 *  All database operations used by admin-dashboard.service,
 *  admin-operations.service, and data-validation.service,
 *  expressed as a technology-agnostic contract.
 * ──────────────────────────────────────────────────────────────────── */

// ── Dashboard DTOs ────────────────────────────────────────────────

export interface ProductPerformanceRow {
  productId: string;
  productCode: string | null;
  title: string;
  totalOrders: number;
  totalQuantitySold: number;
  totalRevenue: number;
  totalMargin: number;
}

export interface SellersMappedRow {
  productId: string;
  productCode: string | null;
  title: string;
  sellerCount: number;
}

export interface LowestStockRow {
  productId: string;
  productCode: string | null;
  title: string;
  totalStock: number;
}

export interface SellerBasic {
  id: string;
  sellerName: string;
  sellerShopName: string;
  status: string;
}

export interface SellerSubOrderCounts {
  totalSubOrders: number;
  rejectedSubOrders: number;
}

export interface SellerRevenueResult {
  totalSettlementAmount: number;
}

export interface SellerMappingStats {
  totalMappedProducts: number;
  totalStockQty: number;
  avgDispatchSla: number;
}

export interface TopAllocatedSellerRow {
  sellerId: string;
  allocationCount: number;
}

export interface SellerNameEntry {
  id: string;
  sellerName: string;
  sellerShopName: string;
}

// ── Operations DTOs ──────────────────────────────────────────────

export interface ProductBasic {
  id: string;
  isDeleted: boolean;
}

export interface VariantBasic {
  id: string;
}

export interface SubOrderWithItems {
  id: string;
  sellerId: string;
  masterOrderId: string;
  acceptStatus: string;
  items: SubOrderItemData[];
  masterOrder: { id: string; orderNumber: string };
}

export interface SubOrderItemData {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
}

export interface SellerForValidation {
  id: string;
  status: string;
  sellerName: string;
}

export interface SellerProductMappingBasic {
  id: string;
  sellerId: string;
  productId: string;
  variantId: string | null;
  stockQty: number;
  reservedQty: number;
  isActive: boolean;
}

export interface StockReservationBasic {
  id: string;
  mappingId: string;
  quantity: number;
  status: string;
}

// ── Data-validation DTOs ─────────────────────────────────────────

export interface ProductSample {
  id: string;
  title: string;
  sellerId: string | null;
  createdAt: Date;
}

export interface VariantSample {
  id: string;
  productId: string;
  sku: string | null;
  title: string | null;
  createdAt: Date;
}

export interface ActiveProductNoMappingSample {
  id: string;
  title: string;
  productCode: string | null;
  sellerId: string | null;
  createdAt: Date;
}

export interface ReservationSample {
  id: string;
  mappingId: string;
  quantity: number;
  expiresAt: Date;
  createdAt: Date;
}

// ── Transaction callback type ────────────────────────────────────

export interface AdminControlTowerTxOperations {
  findReservationsForRelease(
    orderId: string,
    sellerId: string,
  ): Promise<StockReservationBasic[]>;
  releaseReservation(reservationId: string, mappingId: string, quantity: number): Promise<void>;
  createConfirmedReservation(
    mappingId: string,
    quantity: number,
    orderId: string,
  ): Promise<void>;
  incrementMappingReservedQty(mappingId: string, quantity: number): Promise<void>;
  updateSubOrderSeller(subOrderId: string, newSellerId: string): Promise<void>;
  createAllocationLog(data: {
    productId: string;
    variantId: string | null;
    customerPincode: string;
    allocatedSellerId: string;
    allocationReason: string;
    isReallocated: boolean;
    orderId: string;
  }): Promise<void>;
  findSellerMapping(
    sellerId: string,
    productId: string,
    variantId: string | null,
  ): Promise<SellerProductMappingBasic | null>;
}

// ── Repository interface ────────────────────────────────────────

export interface AdminControlTowerRepository {
  /* ── Dashboard (KPIs) ── */
  countMasterOrders(): Promise<number>;
  sumPaidOrderRevenue(): Promise<number>;
  countActiveProducts(): Promise<number>;
  countActiveSellers(): Promise<number>;
  countUsers(): Promise<number>;
  countOrdersSince(since: Date): Promise<number>;
  sumPaidRevenueSince(since: Date): Promise<number>;
  countPendingSubOrders(): Promise<number>;
  sumPlatformMargin(): Promise<number>;

  /* ── Dashboard (product performance) ── */
  getTopProductsByRevenue(periodStart: Date, limit: number): Promise<ProductPerformanceRow[]>;
  getMostSellersMapped(limit: number): Promise<SellersMappedRow[]>;
  getLowestStockProducts(limit: number): Promise<LowestStockRow[]>;

  /* ── Dashboard (seller performance) ── */
  findAllSellers(): Promise<SellerBasic[]>;
  getSellerSubOrderCounts(sellerId: string): Promise<SellerSubOrderCounts>;
  getSellerRevenue(sellerId: string): Promise<SellerRevenueResult>;
  getSellerMappingStats(sellerId: string): Promise<SellerMappingStats>;

  /* ── Dashboard (allocation analytics) ── */
  countAllocations(): Promise<number>;
  countReallocations(): Promise<number>;
  getAvgAllocationMetrics(): Promise<{ avgDistanceKm: number; avgScore: number }>;
  getTopAllocatedSellers(limit: number): Promise<TopAllocatedSellerRow[]>;
  findSellersByIds(ids: string[]): Promise<SellerNameEntry[]>;

  /* ── Operations (bulk pricing) ── */
  findProductById(productId: string): Promise<ProductBasic | null>;
  updateProductPrice(productId: string, price: number): Promise<void>;
  findVariantForProduct(variantId: string, productId: string): Promise<VariantBasic | null>;
  updateVariantPrice(variantId: string, price: number): Promise<void>;

  /* ── Operations (reassignment) ── */
  findSubOrderWithItems(subOrderId: string): Promise<SubOrderWithItems | null>;
  findSellerById(sellerId: string): Promise<SellerForValidation | null>;
  findActiveSellerMapping(
    sellerId: string,
    productId: string,
    variantId: string | null,
  ): Promise<SellerProductMappingBasic | null>;
  executeReassignment(
    callback: (tx: AdminControlTowerTxOperations) => Promise<void>,
  ): Promise<void>;

  /* ── Operations (mapping suspension) ── */
  findSellerBasic(sellerId: string): Promise<{ id: string; sellerName: string; isDeleted: boolean } | null>;
  suspendSellerMappings(sellerId: string): Promise<number>;
  activateSellerMappings(sellerId: string): Promise<number>;

  /* ── Data validation ── */
  countProductsWithoutCode(): Promise<number>;
  sampleProductsWithoutCode(take: number): Promise<ProductSample[]>;
  countVariantsWithoutMasterSku(): Promise<number>;
  sampleVariantsWithoutMasterSku(take: number): Promise<VariantSample[]>;
  countActiveProductsNoMappings(): Promise<number>;
  sampleActiveProductsNoMappings(take: number): Promise<ActiveProductNoMappingSample[]>;
  countMappingsWithDeletedProducts(): Promise<number>;
  countMappingsWithDeletedVariants(): Promise<number>;
  countOrderItemsReferencingDeletedProducts(): Promise<number>;
  countOrphanedCommissionRecords(): Promise<number>;
  countOrphanedReservations(): Promise<number>;
  sampleOrphanedReservations(take: number): Promise<ReservationSample[]>;
  countActiveProductsZeroStock(): Promise<number>;
  countTotalProducts(): Promise<number>;
  countTotalActiveProducts(): Promise<number>;
  countTotalVariants(): Promise<number>;
  countTotalMappings(): Promise<number>;
  countTotalActiveMappings(): Promise<number>;
  countTotalOrders(): Promise<number>;
  countTotalCommissionRecords(): Promise<number>;
  countTotalReservations(): Promise<number>;
}

export const ADMIN_CONTROL_TOWER_REPOSITORY = Symbol('AdminControlTowerRepository');
