import { apiClient, ApiResponse, API_BASE } from '@/lib/api-client';

export interface SalesSummary {
  grossRevenue: number;
  netRevenue: number;
  orderCount: number;
  averageOrderValue: number;
  byDay: Array<{ date: string; revenue: number; orders: number }>;
}

export interface OrderStatusMix {
  status: string;
  count: number;
  amount: number;
}

export interface ProductPerformance {
  productId: string;
  title: string;
  unitsSold: number;
  revenue: number;
}

export interface CustomerAnalytics {
  totalCustomers: number;
  newInPeriod: number;
  returningInPeriod: number;
  averageLifetimeOrders: number;
}

export interface ConversionFunnel {
  cartCreated: number;
  checkoutInitiated: number;
  ordersPlaced: number;
  ordersPaid: number;
  cartToCheckoutRate: number;
  checkoutToPaidRate: number;
}

export interface SalesCompare {
  current: SalesSummary;
  previous: SalesSummary;
  deltas: {
    grossRevenuePct: number | null;
    netRevenuePct: number | null;
    orderCountPct: number | null;
    averageOrderValuePct: number | null;
  };
}

function buildQs(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const adminAnalyticsService = {
  sales(start?: string, end?: string): Promise<ApiResponse<SalesSummary>> {
    return apiClient<SalesSummary>(`/admin/analytics/sales${buildQs({ start, end })}`);
  },
  compare(start?: string, end?: string): Promise<ApiResponse<SalesCompare>> {
    return apiClient<SalesCompare>(`/admin/analytics/sales/compare${buildQs({ start, end })}`);
  },
  orderStatusMix(start?: string, end?: string): Promise<ApiResponse<OrderStatusMix[]>> {
    return apiClient<OrderStatusMix[]>(`/admin/analytics/orders/status-mix${buildQs({ start, end })}`);
  },
  topProducts(start?: string, end?: string, limit = 10): Promise<ApiResponse<ProductPerformance[]>> {
    return apiClient<ProductPerformance[]>(`/admin/analytics/products/top${buildQs({ start, end, limit })}`);
  },
  bottomProducts(start?: string, end?: string, limit = 10): Promise<ApiResponse<ProductPerformance[]>> {
    return apiClient<ProductPerformance[]>(`/admin/analytics/products/bottom${buildQs({ start, end, limit })}`);
  },
  customers(start?: string, end?: string): Promise<ApiResponse<CustomerAnalytics>> {
    return apiClient<CustomerAnalytics>(`/admin/analytics/customers${buildQs({ start, end })}`);
  },
  conversion(start?: string, end?: string): Promise<ApiResponse<ConversionFunnel>> {
    return apiClient<ConversionFunnel>(`/admin/analytics/conversion${buildQs({ start, end })}`);
  },
  /**
   * Download a CSV report. Uses an authenticated fetch (bearer token
   * from sessionStorage) → Blob → object-URL <a> click, because:
   *   1. the endpoint sits behind AdminAuthGuard, and a plain
   *      `<a download href>` wouldn't carry the Authorization header;
   *   2. apiClient would try to JSON.parse the response and fail.
   * Throws so callers can surface "Download failed" in the UI.
   */
  async downloadCsv(
    report: 'sales-daily' | 'top-products' | 'bottom-products' | 'order-status-mix',
    start: string,
    end: string,
  ): Promise<void> {
    const token =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem('adminAccessToken')
        : null;
    const url = `${API_BASE}/api/v1/admin/analytics/export/${report}.csv${buildQs({ start, end })}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      let msg = `Download failed (${res.status})`;
      try {
        const json = await res.json();
        if (json?.message) msg = Array.isArray(json.message) ? json.message.join(', ') : String(json.message);
      } catch { /* response wasn't JSON */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    // Filename comes from Content-Disposition; fall back to "<report>.csv".
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const match = /filename="?([^"]+)"?/i.exec(disposition);
    const filename = match?.[1] ?? `${report}.csv`;
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  },
};

export function inr(n: number): string {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
export function inrFromPaise(p: number): string {
  return inr(p / 100);
}
