import { apiClient, ApiResponse } from '@/lib/api-client';

export type ProductSource = 'SELLER' | 'OWN_BRAND';
export type OwnBrandProcurementStatus =
  | 'DRAFT'
  | 'PLACED'
  | 'IN_TRANSIT'
  | 'RECEIVED'
  | 'CANCELLED';

export interface OwnBrandWarehouse {
  id: string;
  code: string;
  name: string;
  pincode: string;
  addressLine: string;
  city: string;
  state: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OwnBrandStock {
  id: string;
  warehouseId: string;
  productId: string;
  variantId: string | null;
  stockQty: number;
  reservedQty: number;
  lowStockThreshold: number;
  lastLandedCost: string | null;
  createdAt: string;
  updatedAt: string;
  warehouse: OwnBrandWarehouse;
}

export interface OwnBrandProduct {
  id: string;
  productCode: string | null;
  title: string;
  slug: string;
  productSource: ProductSource;
  ownBrandSku: string | null;
  basePrice: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface OwnBrandProductListPage {
  items: OwnBrandProduct[];
  page: number;
  limit: number;
  total: number;
}

export interface ProcurementOrderItem {
  id: string;
  poId: string;
  productId: string;
  variantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  ownBrandSku: string | null;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: string;
  lineTotal: string;
}

export interface ProcurementOrder {
  id: string;
  poNumber: string;
  warehouseId: string;
  supplierName: string;
  status: OwnBrandProcurementStatus;
  expectedDate: string | null;
  receivedAt: string | null;
  totalAmount: string;
  supplierReference: string | null;
  notes: string | null;
  createdByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProcurementDetail extends ProcurementOrder {
  items: ProcurementOrderItem[];
  warehouse: OwnBrandWarehouse;
}

export interface ProcurementListPage {
  items: ProcurementOrder[];
  page: number;
  limit: number;
  total: number;
}

export const adminNovaService = {
  // ── Warehouses ─────────────────────────────────────────────────
  listWarehouses(activeOnly = false): Promise<ApiResponse<OwnBrandWarehouse[]>> {
    const qs = activeOnly ? '?activeOnly=true' : '';
    return apiClient<OwnBrandWarehouse[]>(`/admin/nova/warehouses${qs}`);
  },
  createWarehouse(payload: {
    code: string;
    name: string;
    pincode: string;
    addressLine: string;
    city: string;
    state: string;
  }): Promise<ApiResponse<OwnBrandWarehouse>> {
    return apiClient<OwnBrandWarehouse>('/admin/nova/warehouses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  updateWarehouse(
    id: string,
    payload: Partial<{
      name: string;
      pincode: string;
      addressLine: string;
      city: string;
      state: string;
      isActive: boolean;
    }>,
  ): Promise<ApiResponse<OwnBrandWarehouse>> {
    return apiClient<OwnBrandWarehouse>(`/admin/nova/warehouses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  deactivateWarehouse(id: string): Promise<ApiResponse<OwnBrandWarehouse>> {
    return apiClient<OwnBrandWarehouse>(`/admin/nova/warehouses/${id}`, {
      method: 'DELETE',
    });
  },

  // ── Stocks ─────────────────────────────────────────────────────
  listStocks(filter: {
    warehouseId?: string;
    productId?: string;
    lowStockOnly?: boolean;
  } = {}): Promise<ApiResponse<OwnBrandStock[]>> {
    const qs = new URLSearchParams();
    if (filter.warehouseId) qs.set('warehouseId', filter.warehouseId);
    if (filter.productId) qs.set('productId', filter.productId);
    if (filter.lowStockOnly) qs.set('lowStockOnly', 'true');
    const s = qs.toString();
    return apiClient<OwnBrandStock[]>(`/admin/nova/stocks${s ? `?${s}` : ''}`);
  },
  adjustStock(payload: {
    warehouseId: string;
    productId: string;
    variantId?: string;
    delta: number;
    reason: string;
  }): Promise<ApiResponse<OwnBrandStock>> {
    return apiClient<OwnBrandStock>('/admin/nova/stocks/adjust', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // ── Products ───────────────────────────────────────────────────
  listProducts(filter: { page?: number; limit?: number; search?: string } = {}): Promise<
    ApiResponse<OwnBrandProductListPage>
  > {
    const qs = new URLSearchParams();
    qs.set('page', String(filter.page ?? 1));
    qs.set('limit', String(filter.limit ?? 20));
    if (filter.search?.trim()) qs.set('search', filter.search.trim());
    return apiClient<OwnBrandProductListPage>(
      `/admin/nova/products?${qs.toString()}`,
    );
  },
  convertProduct(productId: string): Promise<ApiResponse<OwnBrandProduct>> {
    return apiClient<OwnBrandProduct>(
      `/admin/nova/products/${productId}/convert`,
      { method: 'POST' },
    );
  },
  unconvertProduct(productId: string): Promise<ApiResponse<OwnBrandProduct>> {
    return apiClient<OwnBrandProduct>(
      `/admin/nova/products/${productId}/unconvert`,
      { method: 'POST' },
    );
  },

  // ── Procurement ────────────────────────────────────────────────
  listProcurement(filter: {
    page?: number;
    limit?: number;
    warehouseId?: string;
    status?: OwnBrandProcurementStatus | '';
    search?: string;
    fromDate?: string;
    toDate?: string;
  } = {}): Promise<ApiResponse<ProcurementListPage>> {
    const qs = new URLSearchParams();
    qs.set('page', String(filter.page ?? 1));
    qs.set('limit', String(filter.limit ?? 20));
    if (filter.warehouseId) qs.set('warehouseId', filter.warehouseId);
    if (filter.status) qs.set('status', filter.status);
    if (filter.search?.trim()) qs.set('search', filter.search.trim());
    if (filter.fromDate) qs.set('fromDate', filter.fromDate);
    if (filter.toDate) qs.set('toDate', filter.toDate);
    return apiClient<ProcurementListPage>(
      `/admin/nova/procurement?${qs.toString()}`,
    );
  },
  listReceiptsForPo(id: string): Promise<ApiResponse<Array<{
    id: string;
    poItemId: string;
    quantityReceived: number;
    notes: string | null;
    receivedByAdminId: string | null;
    createdAt: string;
  }>>> {
    return apiClient(`/admin/nova/procurement/${id}/receipts`);
  },
  listStockMovements(filter: {
    warehouseId?: string;
    productId?: string;
    variantId?: string;
    kind?: 'RECEIPT' | 'ADJUSTMENT' | 'SALE' | 'TRANSFER_IN' | 'TRANSFER_OUT';
    limit?: number;
  } = {}): Promise<ApiResponse<Array<{
    id: string;
    warehouseId: string;
    productId: string;
    variantId: string | null;
    kind: string;
    delta: number;
    stockAfter: number;
    reason: string | null;
    refType: string | null;
    refId: string | null;
    createdByAdminId: string | null;
    createdAt: string;
  }>>> {
    const qs = new URLSearchParams();
    if (filter.warehouseId) qs.set('warehouseId', filter.warehouseId);
    if (filter.productId) qs.set('productId', filter.productId);
    if (filter.variantId) qs.set('variantId', filter.variantId);
    if (filter.kind) qs.set('kind', filter.kind);
    if (filter.limit) qs.set('limit', String(filter.limit));
    const q = qs.toString();
    return apiClient(`/admin/nova/stocks/movements${q ? '?' + q : ''}`);
  },
  getProcurement(id: string): Promise<ApiResponse<ProcurementDetail>> {
    return apiClient<ProcurementDetail>(`/admin/nova/procurement/${id}`);
  },
  createProcurement(payload: {
    warehouseId: string;
    supplierName: string;
    expectedDate?: string;
    supplierReference?: string;
    notes?: string;
    items: Array<{
      productId: string;
      variantId?: string;
      quantityOrdered: number;
      unitCost: number;
    }>;
  }): Promise<ApiResponse<ProcurementDetail>> {
    return apiClient<ProcurementDetail>('/admin/nova/procurement', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  transitionProcurement(
    id: string,
    status: OwnBrandProcurementStatus,
  ): Promise<ApiResponse<ProcurementOrder>> {
    return apiClient<ProcurementOrder>(`/admin/nova/procurement/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },
  receiveProcurement(
    id: string,
    receipts: Array<{ itemId: string; quantityReceived: number }>,
  ): Promise<ApiResponse<ProcurementDetail>> {
    return apiClient<ProcurementDetail>(`/admin/nova/procurement/${id}/receive`, {
      method: 'POST',
      body: JSON.stringify({ receipts }),
    });
  },
};

export const PROCUREMENT_STATUS_COLOR: Record<OwnBrandProcurementStatus, string> = {
  DRAFT: '#7A828F',
  PLACED: '#2A8595',
  IN_TRANSIT: '#d97706',
  RECEIVED: '#15803d',
  CANCELLED: '#b91c1c',
};

export function inr(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '₹0';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
