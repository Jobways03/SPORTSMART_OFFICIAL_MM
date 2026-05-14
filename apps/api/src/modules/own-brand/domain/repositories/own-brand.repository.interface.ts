import type {
  OwnBrandProcurementOrder,
  OwnBrandProcurementOrderItem,
  OwnBrandProcurementReceipt,
  OwnBrandProcurementStatus,
  OwnBrandStock,
  OwnBrandStockMovement,
  OwnBrandStockMovementKind,
  OwnBrandWarehouse,
  Product,
} from '@prisma/client';

export const OWN_BRAND_REPOSITORY = Symbol('OWN_BRAND_REPOSITORY');

export interface CreateWarehouseInput {
  code: string;
  name: string;
  pincode: string;
  addressLine: string;
  city: string;
  state: string;
}

export interface UpdateWarehouseInput {
  name?: string;
  pincode?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  isActive?: boolean;
}

export interface CreateProcurementOrderItemInput {
  productId: string;
  variantId?: string | null;
  productTitle: string;
  variantTitle?: string | null;
  ownBrandSku?: string | null;
  quantityOrdered: number;
  unitCost: number;
}

export interface CreateProcurementOrderInput {
  poNumber: string;
  warehouseId: string;
  supplierName: string;
  expectedDate?: Date | null;
  supplierReference?: string | null;
  notes?: string | null;
  items: CreateProcurementOrderItemInput[];
  createdByAdminId?: string | null;
}

export interface ReceiveProcurementInput {
  poId: string;
  // Per-item quantity_received deltas (additive — supports partial receipts).
  receipts: Array<{ itemId: string; quantityReceived: number; notes?: string }>;
  receivedByAdminId?: string | null;
}

export interface OwnBrandProductListFilter {
  page: number;
  limit: number;
  search?: string;
}

export interface ProcurementListFilter {
  page: number;
  limit: number;
  warehouseId?: string;
  status?: OwnBrandProcurementStatus;
  /** OR-search PO# + supplier name + supplier reference. */
  search?: string;
  /** Filter by createdAt window (ISO strings ok at the controller level). */
  fromDate?: Date;
  toDate?: Date;
}

export interface OwnBrandStockWithLocation extends OwnBrandStock {
  warehouse: OwnBrandWarehouse;
}

export interface OwnBrandProcurementOrderWithItems extends OwnBrandProcurementOrder {
  items: OwnBrandProcurementOrderItem[];
  warehouse: OwnBrandWarehouse;
}

export interface OwnBrandRepository {
  // ── Warehouses ─────────────────────────────────────────────────
  listWarehouses(activeOnly?: boolean): Promise<OwnBrandWarehouse[]>;
  findWarehouseById(id: string): Promise<OwnBrandWarehouse | null>;
  createWarehouse(input: CreateWarehouseInput): Promise<OwnBrandWarehouse>;
  updateWarehouse(id: string, data: UpdateWarehouseInput): Promise<OwnBrandWarehouse>;

  // ── Products ───────────────────────────────────────────────────
  /** Lists products where productSource=OWN_BRAND. */
  listOwnBrandProducts(
    filter: OwnBrandProductListFilter,
  ): Promise<{ items: Product[]; total: number; page: number; limit: number }>;
  findProductById(id: string): Promise<Product | null>;
  /** Mints the next NV-YYYY-NNNNNN sku in a serializable transaction. */
  generateOwnBrandSku(): Promise<string>;
  setProductSource(args: {
    productId: string;
    source: 'SELLER' | 'OWN_BRAND';
    ownBrandSku: string | null;
  }): Promise<Product>;

  // ── Stocks ─────────────────────────────────────────────────────
  listStocks(args: {
    warehouseId?: string;
    productId?: string;
    lowStockOnly?: boolean;
  }): Promise<OwnBrandStockWithLocation[]>;
  /**
   * Adjust stock by a signed delta. Creates the row if missing.
   * Atomically writes a stock-movement ledger entry recording who/why.
   */
  adjustStock(args: {
    warehouseId: string;
    productId: string;
    variantId?: string | null;
    delta: number;
    landedCost?: number | null;
    kind: OwnBrandStockMovementKind;
    reason?: string | null;
    refType?: string | null;
    refId?: string | null;
    adminId?: string | null;
  }): Promise<OwnBrandStock>;

  /** Recent movements for a warehouse + (optional) product/variant. */
  listStockMovements(args: {
    warehouseId?: string;
    productId?: string;
    variantId?: string | null;
    kind?: OwnBrandStockMovementKind;
    limit?: number;
  }): Promise<OwnBrandStockMovement[]>;

  /**
   * Story 3.4 — atomic transfer of Nova stock between two warehouses.
   * Single transaction writes TRANSFER_OUT on source + TRANSFER_IN on
   * destination so the ledger always balances. Rejects if the source
   * doesn't have enough free stock (`stockQty - reservedQty < quantity`).
   * Returns updated rows for both warehouses.
   */
  transferStock(args: {
    fromWarehouseId: string;
    toWarehouseId: string;
    productId: string;
    variantId?: string | null;
    quantity: number;
    reason?: string | null;
    adminId?: string | null;
  }): Promise<{
    fromStock: OwnBrandStock;
    toStock: OwnBrandStock;
  }>;

  /** Receipt audit rows for a PO, ordered chronologically. */
  listReceiptsForPo(poId: string): Promise<OwnBrandProcurementReceipt[]>;
  /** Sum of available stock (stockQty - reservedQty) across all active warehouses
   *  for a product+variant. Used by the routing facade. */
  getAvailableForProduct(
    productId: string,
    variantId?: string | null,
  ): Promise<number>;
  /** Stock per warehouse for a product+variant. */
  findWarehousesWithStock(
    productId: string,
    variantId?: string | null,
  ): Promise<OwnBrandStockWithLocation[]>;

  // ── Procurement ────────────────────────────────────────────────
  generateNextPoNumber(): Promise<string>;
  listProcurement(filter: ProcurementListFilter): Promise<{
    items: OwnBrandProcurementOrder[];
    total: number;
    page: number;
    limit: number;
  }>;
  findProcurementById(id: string): Promise<OwnBrandProcurementOrderWithItems | null>;
  createProcurement(input: CreateProcurementOrderInput): Promise<OwnBrandProcurementOrderWithItems>;
  setProcurementStatus(args: {
    id: string;
    status: OwnBrandProcurementStatus;
    receivedAt?: Date | null;
  }): Promise<OwnBrandProcurementOrder>;
  /**
   * Atomically increments quantity_received per item AND credits stock
   * AND sets lastLandedCost. If every item is fully received, transitions
   * the PO to RECEIVED.
   */
  applyReceipt(input: ReceiveProcurementInput): Promise<OwnBrandProcurementOrderWithItems>;
}
