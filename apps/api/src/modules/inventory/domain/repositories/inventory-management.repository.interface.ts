/* ── Inventory Management Repository Interface ──────────────────────
 *  All database operations used by inventory-management.service,
 *  expressed as a technology-agnostic contract.
 * ──────────────────────────────────────────────────────────────────── */

// ── DTOs ──────────────────────────────────────────────────────────

export interface MappingRecord {
  id: string;
  sellerId: string;
  productId: string;
  variantId: string | null;
  stockQty: number;
  reservedQty: number;
  lowStockThreshold: number;
  isActive: boolean;
  seller: { id: string; sellerName: string; sellerShopName: string };
  product: { id: string; title: string; productCode: string | null };
  variant: { id: string; sku: string | null; masterSku: string | null } | null;
}

export interface MappingBasic {
  id: string;
  sellerId: string;
  productId: string;
  variantId: string | null;
  stockQty: number;
  reservedQty: number;
}

export interface MappingForAggregation {
  productId: string;
  variantId: string | null;
  stockQty: number;
  reservedQty: number;
  product: { id: string; title: string; productCode: string | null; hasVariants: boolean };
  variant: { id: string; sku: string | null; masterSku: string | null } | null;
}

export interface MappingStockInfo {
  stockQty: number;
  reservedQty: number;
  lowStockThreshold: number;
}

export interface StockAggResult {
  totalStockQty: number;
  totalReservedQty: number;
}

export interface VariantLookup {
  id: string;
  masterSku: string | null;
  productId: string;
}

export interface ProductLookup {
  id: string;
  productCode: string | null;
}

export interface ReservationWithMapping {
  id: string;
  mappingId: string;
  quantity: number;
  status: string;
  orderId: string | null;
  expiresAt: Date;
  createdAt: Date;
  mapping: {
    seller: { id: string; sellerName: string; sellerShopName: string };
    product: { id: string; title: string; productCode: string | null };
    variant: { id: string; sku: string | null; masterSku: string | null } | null;
  };
}

// ── Repository interface ────────────────────────────────────────

export interface InventoryManagementRepository {
  /* ── Stock adjustment ── */
  findMappingById(mappingId: string): Promise<MappingBasic | null>;
  updateMappingStock(
    mappingId: string,
    newStockQty: number,
  ): Promise<MappingBasic>;

  /* ── Low stock queries ── */
  findActiveMappingsForSeller(sellerId: string): Promise<MappingRecord[]>;
  findAllActiveMappings(sellerId?: string): Promise<MappingRecord[]>;

  /* ── Out-of-stock ── */
  findActiveMappingsForAggregation(): Promise<MappingForAggregation[]>;

  /* ── Stock import ── */
  findVariantsByMasterSkus(skus: string[]): Promise<VariantLookup[]>;
  findProductsByProductCodes(codes: string[]): Promise<ProductLookup[]>;
  findSellerMappingByProductVariant(
    sellerId: string,
    productId: string,
    variantId: string | null,
  ): Promise<MappingBasic | null>;
  setMappingStockQty(mappingId: string, stockQty: number): Promise<void>;

  /* ── Overview ── */
  countDistinctMappedProducts(): Promise<number>;
  countDistinctMappedVariants(): Promise<number>;
  aggregateActiveStock(): Promise<StockAggResult>;
  findAllActiveMappingStockInfo(): Promise<MappingStockInfo[]>;

  /* ── Reservations ── */
  findActiveReservations(
    page: number,
    limit: number,
    filters?: { mappingId?: string; orderId?: string },
  ): Promise<{ reservations: ReservationWithMapping[]; total: number }>;
}

export const INVENTORY_MANAGEMENT_REPOSITORY = Symbol('InventoryManagementRepository');
