/* ── Inventory Management Repository Interface ──────────────────────
 *  All database operations used by inventory-management.service,
 *  expressed as a technology-agnostic contract.
 * ──────────────────────────────────────────────────────────────────── */

import { SellerType } from '../../../../core/authorization/seller-scope';

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

export interface StockMovementRow {
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
  // `allowedSellerTypes` (when a restricting set) scopes results to those seller
  // types; null/undefined/empty = unrestricted (SUPER_ADMIN) → no filter.
  findAllActiveMappings(
    sellerId?: string,
    allowedSellerTypes?: SellerType[],
  ): Promise<MappingRecord[]>;

  /* ── Out-of-stock ── */
  findActiveMappingsForAggregation(
    allowedSellerTypes?: SellerType[],
  ): Promise<MappingForAggregation[]>;

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
  countDistinctMappedProducts(allowedSellerTypes?: SellerType[]): Promise<number>;
  countDistinctMappedVariants(allowedSellerTypes?: SellerType[]): Promise<number>;
  aggregateActiveStock(allowedSellerTypes?: SellerType[]): Promise<StockAggResult>;
  findAllActiveMappingStockInfo(
    allowedSellerTypes?: SellerType[],
  ): Promise<MappingStockInfo[]>;

  /* ── Reservations ── */
  findActiveReservations(
    page: number,
    limit: number,
    filters?: {
      mappingId?: string;
      orderId?: string;
      allowedSellerTypes?: SellerType[];
    },
  ): Promise<{ reservations: ReservationWithMapping[]; total: number }>;

  /* ── Stock movement audit ── */
  findMovementsByMappingId(
    mappingId: string,
    page: number,
    limit: number,
  ): Promise<{ movements: StockMovementRow[]; total: number }>;
}

export const INVENTORY_MANAGEMENT_REPOSITORY = Symbol('InventoryManagementRepository');
