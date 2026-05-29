export const FRANCHISE_INVENTORY_REPOSITORY = Symbol('FranchiseInventoryRepository');

export interface FranchiseInventoryRepository {
  // Stock snapshot operations
  findStock(
    franchiseId: string,
    productId: string,
    variantId: string | null,
  ): Promise<any | null>;

  findStockByFranchise(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      search?: string;
      lowStockOnly?: boolean;
    },
  ): Promise<{ stocks: any[]; total: number }>;

  findLowStockItems(franchiseId: string): Promise<any[]>;

  upsertStock(data: {
    franchiseId: string;
    productId: string;
    variantId: string | null;
    globalSku: string;
    franchiseSku?: string | null;
    onHandQty: number;
    reservedQty: number;
    availableQty: number;
    damagedQty?: number;
    inTransitQty?: number;
    lowStockThreshold?: number;
  }): Promise<any>;

  // Ledger operations (immutable — create only, never update/delete)
  createLedgerEntry(data: {
    franchiseId: string;
    productId: string;
    variantId: string | null;
    globalSku: string;
    movementType: string;
    quantityDelta: number;
    referenceType: string;
    referenceId?: string;
    remarks?: string;
    beforeQty: number;
    afterQty: number;
    actorType: string;
    actorId?: string;
  }): Promise<any>;

  findLedgerEntries(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      productId?: string;
      movementType?: string;
      referenceType?: string;
      fromDate?: Date;
      toDate?: Date;
    },
  ): Promise<{ entries: any[]; total: number }>;

  // Atomic stock + ledger transaction (the core operation).
  //
  // Phase 55 (2026-05-21) — optional `tx` so an outer transaction
  // (e.g. procurement.confirmReceipt) can compose this call without
  // opening a nested transaction. When `tx` is provided we use it
  // directly; otherwise we open our own $transaction.
  adjustStockWithLedger(
    params: {
      franchiseId: string;
      productId: string;
      variantId: string | null;
      globalSku: string;
      movementType: string;
      quantityDelta: number;
      referenceType: string;
      referenceId?: string;
      remarks?: string;
      actorType: string;
      actorId?: string;
      updateField: 'onHandQty' | 'reservedQty' | 'damagedQty' | 'inTransitQty';
    },
    tx?: import('@prisma/client').Prisma.TransactionClient,
  ): Promise<{ stock: any; ledgerEntry: any }>;

  // Bulk stock initialization (for procurement receipt)
  initializeStock(
    franchiseId: string,
    productId: string,
    variantId: string | null,
    globalSku: string,
    franchiseSku?: string | null,
  ): Promise<any>;
}
