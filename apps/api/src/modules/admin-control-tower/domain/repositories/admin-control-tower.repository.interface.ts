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

export interface TopAllocatedFranchiseRow {
  franchiseId: string;
  franchiseName: string;
  allocationCount: number;
}

export interface SellerNameEntry {
  id: string;
  sellerName: string;
  sellerShopName: string;
}

// ── Allocation analytics (Phase 233) ─────────────────────────────

/**
 * Phase 233 — filters threaded from the dashboard query DTO down to
 * every aggregate. The eventSource exclusion (LIVE / REALLOCATION /
 * MANUAL_REASSIGNMENT only) is applied by the repository regardless of
 * these — `fromDate`/`toDate`/`nodeType` are the *additional* operator
 * filters layered on top of that always-on noise exclusion.
 */
export interface AllocationAnalyticsFilters {
  fromDate?: Date;
  toDate?: Date;
  /** 'SELLER' | 'FRANCHISE' — matched against allocated_node_type. */
  nodeType?: string;
}

/** One outcome bucket from the GROUP BY `outcome` over real rows. */
export interface AllocationOutcomeCountRow {
  outcome: string | null;
  count: number;
}

/**
 * Phase 233 — drill-down filters for the raw-row endpoint. A superset
 * of {@link AllocationAnalyticsFilters}: adds explicit `outcome` /
 * `eventSource` selectors (so an operator can list the excluded
 * PREVIEW/LISTING rows too) plus pagination. When `eventSource` is
 * omitted the drill-down still defaults to the real-routing subset for
 * consistency with the counters.
 */
export interface AllocationEventsFilters {
  outcome?: string;
  eventSource?: string;
  fromDate?: Date;
  toDate?: Date;
  nodeType?: string;
  page: number;
  limit: number;
}

/** One raw allocation_logs row surfaced by the drill-down. */
export interface AllocationEventRow {
  id: string;
  productId: string;
  variantId: string | null;
  customerPincode: string;
  allocatedNodeType: string | null;
  allocatedSellerId: string | null;
  allocatedFranchiseId: string | null;
  allocationReason: string | null;
  eventSource: string;
  outcome: string | null;
  reasonCode: string | null;
  distanceKm: number | null;
  score: number | null;
  isReallocated: boolean;
  orderId: string | null;
  createdAt: Date;
}

export interface AllocationEventsPage {
  rows: AllocationEventRow[];
  total: number;
  page: number;
  limit: number;
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

  /* ── Dashboard (allocation analytics) ──
   *
   * Phase 233 — every aggregate takes the optional filter bag and
   * applies the always-on eventSource exclusion (real routing rows
   * only). The legacy no-arg callers keep working because the bag is
   * optional and an empty bag means "all-time, all node types".
   */
  countAllocations(filters?: AllocationAnalyticsFilters): Promise<number>;
  countReallocations(filters?: AllocationAnalyticsFilters): Promise<number>;
  getAvgAllocationMetrics(
    filters?: AllocationAnalyticsFilters,
  ): Promise<{ avgDistanceKm: number; avgScore: number }>;
  getOutcomeCounts(
    filters?: AllocationAnalyticsFilters,
  ): Promise<AllocationOutcomeCountRow[]>;
  getTopAllocatedSellers(
    limit: number,
    filters?: AllocationAnalyticsFilters,
  ): Promise<TopAllocatedSellerRow[]>;
  getTopAllocatedFranchises(
    limit: number,
    filters?: AllocationAnalyticsFilters,
  ): Promise<TopAllocatedFranchiseRow[]>;
  findSellersByIds(ids: string[]): Promise<SellerNameEntry[]>;
  /** Count MasterOrders currently parked in the exception queue. */
  countExceptionQueueOrders(): Promise<number>;
  /** Phase 233 — drill-down: paginated raw allocation_logs rows. */
  getAllocationEvents(
    filters: AllocationEventsFilters,
  ): Promise<AllocationEventsPage>;

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
  /**
   * Phase 59 (2026-05-22) — added `status` so the service can warn
   * when the seller-account itself is already suspended (audit
   * Gap #7), and the audit payload can record the seller's
   * account-level status alongside per-mapping state.
   */
  findSellerBasic(
    sellerId: string,
  ): Promise<{
    id: string;
    sellerName: string;
    isDeleted: boolean;
    status: string;
  } | null>;
  /**
   * Phase 59 (2026-05-22) — status-conditional bulk suspend (audit
   * Gaps #1 + #2 + #3). Only flips mappings that are currently
   * APPROVED + isActive=true; PENDING_APPROVAL, REJECTED, STOPPED,
   * and already-SUSPENDED rows are untouched. Stamps suspendedBy,
   * suspendedAt, suspensionReason. Returns the affected mapping
   * ids so the caller can release active reservations and emit
   * per-mapping side effects.
   */
  suspendSellerMappings(
    sellerId: string,
    adminId: string,
    reason: string,
  ): Promise<{ count: number; affectedMappingIds: string[] }>;
  /**
   * Phase 59 (2026-05-22) — status-conditional bulk reactivate
   * (audit Gap #1). Only flips mappings that are currently
   * SUSPENDED + isActive=false (i.e. the ones bulk-suspended via
   * the symmetric path); STOPPED / REJECTED / PENDING_APPROVAL
   * rows are untouched so an admin cannot silently overwrite a
   * prior rejection or per-mapping stop with a single click.
   */
  activateSellerMappings(
    sellerId: string,
    adminId: string,
    reason: string,
  ): Promise<{ count: number; affectedMappingIds: string[] }>;
  /**
   * Phase 59 (2026-05-22) — releases every active (RESERVED) stock
   * reservation pointing at any of the given mappings (audit Gap
   * #6). Each row is flipped status RESERVED → RELEASED inside
   * its own per-row transaction (matching the expiry-sweep CAS
   * pattern); the corresponding mapping's reservedQty is
   * decremented atomically. Returns per-reservation snapshots so
   * the caller can write ledger entries and emit cart-update
   * events.
   */
  releaseReservationsForMappings(
    mappingIds: string[],
  ): Promise<Array<{
    reservationId: string;
    mappingId: string;
    quantity: number;
    orderId: string | null;
    customerId: string | null;
    sessionId: string | null;
    cartId: string | null;
    stockQty: number;
    beforeReservedQty: number;
    afterReservedQty: number;
  }>>;

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
