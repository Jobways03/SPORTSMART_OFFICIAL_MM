import { apiClient, API_BASE, ApiError, ApiResponse } from '@/lib/api-client';

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
  // Phase 159r — cumulative quantity already returned across prior partial
  // returns. The return modal computes `remaining = quantity - returnedQty`
  // and clamps the per-line return qty to it (backend enforces the same).
  returnedQty?: number;
  unitPrice: number | string;
  lineDiscount: number | string;
  lineTotal: number | string;
  // Phase 26 GST (POS) — per-item tax snapshot. Stored as Decimal on
  // the backend so the wire format is `number | string`. Bills printed
  // off a POS sale must show HSN + CGST/SGST/IGST per Section 31 CGST
  // Act; these fields supply that data without a separate fetch.
  hsnCode?: string | null;
  gstRateBps?: number;
  taxableAmount?: number | string;
  cgstAmount?: number | string;
  sgstAmount?: number | string;
  igstAmount?: number | string;
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
  // Phase 26 GST (POS) — sale-level breakdown. POS sales are always
  // intra-state today so cgst+sgst will be populated and igst=0.
  cgstAmount?: number | string;
  sgstAmount?: number | string;
  igstAmount?: number | string;
  placeOfSupplyState?: string | null;
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

export type PosReturnCondition = 'SALEABLE' | 'DAMAGED';
export type PosRefundMethod = 'CASH' | 'UPI' | 'CARD' | 'MANUAL';

export interface PosReturnSaleItemPayload {
  itemId: string;
  returnQty: number;
  // Phase 159r — DAMAGED units restock to damagedQty, SALEABLE to onHandQty.
  condition?: PosReturnCondition;
}

export interface PosReturnSalePayload {
  items: PosReturnSaleItemPayload[];
  // Phase 159r — refundMethod is REQUIRED by the backend (@IsNotEmpty). The
  // old FE omitted it, which 400'd every return.
  refundMethod: PosRefundMethod;
  returnReason?: string;
  refundReference?: string;
}

export interface PosDailyReport {
  totalSales: number;
  totalGrossAmount: number;
  totalDiscountAmount: number;
  // Phase 159s — net of refunds (returned sales keep netAmount but carry
  // refundedAmount, so this is net − refunded).
  totalNetAmount: number;
  salesByPaymentMethod: Record<string, { count: number; amount: number }>;
  salesByType: Record<string, { count: number; amount: number }>;
  // Phase 159s — fields the backend now returns but the FE previously dropped.
  refundTotal: number;
  voidedSales: { count: number; amount: number };
  returnedSales: { count: number };
  tax: { cgst: number; sgst: number; igst: number; total: number };
}

// Phase 242 — a persisted cash-vs-bank reconciliation row. Paise amounts are
// serialized as strings (BigInt on the backend).
export interface PosCashReconciliation {
  id: string;
  businessDate: string;
  expectedCashInPaise: string;
  actualCashInPaise: string;
  bankDepositInPaise: string;
  bankDepositReference: string | null;
  varianceInPaise: string;
  status: 'MATCHED' | 'VARIANCE';
  notes: string | null;
}

export interface PosDailyReconciliation extends PosDailyReport {
  inventoryReconciliation: {
    totalItemsSold: number;
    totalItemsReturned: number;
    totalItemsVoided: number;
    netItemsMovement: number;
  };
  // Phase 242 — server-authoritative expected cash (paise, string) + any
  // already-submitted reconciliation row for the date (null if none yet).
  expectedCashInPaise: string;
  cashReconciliation: PosCashReconciliation | null;
  closureStatus: string;
  generatedAt: string;
}

export interface PosSubmitReconciliationPayload {
  businessDate: string;
  actualCashInPaise: number;
  bankDepositInPaise?: number;
  bankDepositReference?: string;
  notes?: string;
}

// recordSale + returnSale are @Idempotent on the backend (they read the
// `X-Idempotency-Key` header). A POS terminal on a flaky network can re-fire
// the same mutation; a fresh per-attempt key lets the server dedup the retry
// so we never double-stock-deduct / double-restock / double-receipt.
function idempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const franchisePosService = {
  recordSale(payload: PosRecordSalePayload): Promise<ApiResponse<PosSale>> {
    return apiClient<PosSale>('/franchise/pos/sales', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'X-Idempotency-Key': idempotencyKey() },
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
      headers: { 'X-Idempotency-Key': idempotencyKey() },
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

  // Phase 159s — finance CSV export. The endpoint streams raw text/csv (not a
  // JSON envelope), so we bypass apiClient and fetch the blob directly, carrying
  // the bearer token + auth cookie the same way apiClient does.
  async getDailyReportCsv(date: string): Promise<Blob> {
    let token: string | null = null;
    try {
      token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('accessToken')
          : null;
    } catch {
      token = null;
    }
    const res = await fetch(
      `${API_BASE}/api/v1/franchise/pos/daily-report.csv?date=${encodeURIComponent(date)}`,
      {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      },
    );
    if (!res.ok) {
      throw new ApiError(res.status, {
        success: false,
        message: `Failed to download CSV (status ${res.status})`,
      });
    }
    return res.blob();
  },

  // Phase 242 — submit the day's counted cash + bank deposit. The server
  // recomputes expected cash authoritatively, so we never send it.
  submitReconciliation(
    payload: PosSubmitReconciliationPayload,
  ): Promise<ApiResponse<PosCashReconciliation>> {
    return apiClient<PosCashReconciliation>('/franchise/pos/reconciliation', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'X-Idempotency-Key': idempotencyKey() },
    });
  },
};
