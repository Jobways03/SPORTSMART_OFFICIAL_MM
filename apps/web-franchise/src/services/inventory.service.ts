import { apiClient } from '@/lib/api-client';

export interface StockItem {
  id: string;
  franchiseId: string;
  productId: string;
  variantId: string | null;
  globalSku: string;
  franchiseSku: string | null;
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
  damagedQty: number;
  inTransitQty: number;
  lowStockThreshold: number;
  lastRestockedAt: string | null;
  product?: {
    id: string;
    title: string;
    images?: Array<{ url: string; isPrimary: boolean }>;
  };
  variant?: { title: string | null } | null;
}

export interface LedgerEntry {
  id: string;
  franchiseId: string;
  productId: string;
  variantId: string | null;
  globalSku: string;
  movementType: string;
  quantityDelta: number;
  referenceType: string;
  referenceId: string | null;
  remarks: string | null;
  beforeQty: number;
  afterQty: number;
  actorType: string;
  actorId: string | null;
  createdAt: string;
}

export interface AdjustStockPayload {
  productId: string;
  variantId?: string;
  adjustmentType: 'DAMAGE' | 'LOSS' | 'ADJUSTMENT' | 'AUDIT_CORRECTION';
  quantity: number;
  reason: string;
}

export const franchiseInventoryService = {
  listStock(
    params: { page?: number; limit?: number; search?: string; lowStockOnly?: boolean } = {},
  ) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.search) qs.set('search', params.search);
    if (params.lowStockOnly) qs.set('lowStockOnly', 'true');
    return apiClient<{ stocks: StockItem[]; total: number; page: number; totalPages: number }>(
      `/franchise/inventory?${qs.toString()}`,
    );
  },
  getLowStock() {
    return apiClient<StockItem[]>('/franchise/inventory/low-stock');
  },
  getStockDetail(productId: string, variantId?: string) {
    const qs = variantId ? `?variantId=${variantId}` : '';
    return apiClient<StockItem>(`/franchise/inventory/${productId}${qs}`);
  },
  getLedger(
    params: {
      page?: number;
      limit?: number;
      productId?: string;
      movementType?: string;
      referenceType?: string;
      fromDate?: string;
      toDate?: string;
    } = {},
  ) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.productId) qs.set('productId', params.productId);
    if (params.movementType) qs.set('movementType', params.movementType);
    if (params.referenceType) qs.set('referenceType', params.referenceType);
    if (params.fromDate) qs.set('fromDate', params.fromDate);
    if (params.toDate) qs.set('toDate', params.toDate);
    return apiClient<{
      entries: LedgerEntry[];
      total: number;
      page: number;
      totalPages: number;
    }>(`/franchise/inventory/ledger?${qs.toString()}`);
  },
  adjustStock(payload: AdjustStockPayload) {
    return apiClient('/franchise/inventory/adjust', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
