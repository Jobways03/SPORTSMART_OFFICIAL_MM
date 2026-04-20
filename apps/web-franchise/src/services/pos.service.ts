import { apiClient, ApiResponse } from '@/lib/api-client';

export type PosSaleType = 'WALK_IN' | 'PHONE_ORDER' | 'LOCAL_DELIVERY';
export type PosPaymentMethod = 'CASH' | 'UPI' | 'CARD';
export type PosSaleStatus =
  | 'COMPLETED'
  | 'VOIDED'
  | 'RETURNED'
  | 'PARTIALLY_RETURNED';

export interface PosSaleItem {
  id: string;
  saleId: string;
  productId: string;
  variantId: string | null;
  globalSku: string;
  franchiseSku: string | null;
  productTitle: string;
  variantTitle: string | null;
  quantity: number;
  unitPrice: number | string;
  lineDiscount: number | string;
  lineTotal: number | string;
  createdAt: string;
}

export interface PosSale {
  id: string;
  saleNumber: string;
  franchiseId: string;
  saleType: PosSaleType | string;
  customerName: string | null;
  customerPhone: string | null;
  grossAmount: number | string;
  discountAmount: number | string;
  taxAmount: number | string;
  netAmount: number | string;
  paymentMethod: PosPaymentMethod | string;
  status: PosSaleStatus | string;
  soldAt: string;
  createdByStaffId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  items?: PosSaleItem[];
  _count?: { items: number };
  franchise?: {
    id: string;
    franchiseCode: string;
    businessName: string;
    ownerName: string;
  };
}

export interface PosListSalesResponse {
  sales: PosSale[];
  total: number;
}

export interface PosRecordSaleItemPayload {
  productId: string;
  variantId?: string;
  quantity: number;
  unitPrice: number;
  lineDiscount?: number;
}

export interface PosRecordSalePayload {
  saleType?: PosSaleType;
  customerName?: string;
  customerPhone?: string;
  paymentMethod?: PosPaymentMethod;
  items: PosRecordSaleItemPayload[];
}

export interface PosVoidSalePayload {
  reason: string;
}

export interface PosReturnSaleItemPayload {
  itemId: string;
  returnQty: number;
}

export interface PosReturnSalePayload {
  items: PosReturnSaleItemPayload[];
}

export interface PosDailyReport {
  totalSales: number;
  totalGrossAmount: number;
  totalDiscountAmount: number;
  totalNetAmount: number;
  salesByPaymentMethod: Record<string, { count: number; amount: number }>;
  salesByType: Record<string, { count: number; amount: number }>;
}

export interface PosDailyReconciliation extends PosDailyReport {
  inventoryReconciliation: {
    totalItemsSold: number;
    totalItemsReturned: number;
    netItemsMovement: number;
  };
  closureStatus: string;
  generatedAt: string;
}

export const franchisePosService = {
  recordSale(payload: PosRecordSalePayload): Promise<ApiResponse<PosSale>> {
    return apiClient<PosSale>('/franchise/pos/sales', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  listSales(
    params: {
      page?: number;
      limit?: number;
      status?: string;
      saleType?: string;
      fromDate?: string;
      toDate?: string;
      search?: string;
    } = {},
  ): Promise<ApiResponse<PosListSalesResponse>> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.status) qs.set('status', params.status);
    if (params.saleType) qs.set('saleType', params.saleType);
    if (params.fromDate) qs.set('fromDate', params.fromDate);
    if (params.toDate) qs.set('toDate', params.toDate);
    if (params.search) qs.set('search', params.search);
    return apiClient<PosListSalesResponse>(
      `/franchise/pos/sales?${qs.toString()}`,
    );
  },

  getSale(saleId: string): Promise<ApiResponse<PosSale>> {
    return apiClient<PosSale>(`/franchise/pos/sales/${saleId}`);
  },

  voidSale(
    saleId: string,
    payload: PosVoidSalePayload,
  ): Promise<ApiResponse<PosSale>> {
    return apiClient<PosSale>(`/franchise/pos/sales/${saleId}/void`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  returnSale(
    saleId: string,
    payload: PosReturnSalePayload,
  ): Promise<ApiResponse<PosSale>> {
    return apiClient<PosSale>(`/franchise/pos/sales/${saleId}/return`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getDailyReport(date: string): Promise<ApiResponse<PosDailyReport>> {
    return apiClient<PosDailyReport>(
      `/franchise/pos/daily-report?date=${encodeURIComponent(date)}`,
    );
  },

  getReconciliation(
    date: string,
  ): Promise<ApiResponse<PosDailyReconciliation>> {
    return apiClient<PosDailyReconciliation>(
      `/franchise/pos/reconciliation?date=${encodeURIComponent(date)}`,
    );
  },
};
