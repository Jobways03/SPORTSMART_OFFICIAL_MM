import type { OwnBrandProcurementStatus } from '@prisma/client';

// ── Warehouses ─────────────────────────────────────────────────

export interface CreateWarehouseDto {
  code: string;
  name: string;
  pincode: string;
  addressLine: string;
  city: string;
  state: string;
}

export interface UpdateWarehouseDto {
  name?: string;
  pincode?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  isActive?: boolean;
}

// ── Stocks ─────────────────────────────────────────────────────

export interface AdjustStockDto {
  warehouseId: string;
  productId: string;
  variantId?: string;
  delta: number;
  reason: string;
}

// ── Procurement ────────────────────────────────────────────────

export interface CreateProcurementItemDto {
  productId: string;
  variantId?: string;
  quantityOrdered: number;
  unitCost: number;
}

export interface CreateProcurementDto {
  warehouseId: string;
  supplierName: string;
  expectedDate?: string; // ISO
  supplierReference?: string;
  notes?: string;
  items: CreateProcurementItemDto[];
}

export interface ReceiveProcurementDto {
  receipts: Array<{
    itemId: string;
    quantityReceived: number;
    notes?: string;
  }>;
}

export interface TransitionStatusDto {
  status: OwnBrandProcurementStatus;
}
