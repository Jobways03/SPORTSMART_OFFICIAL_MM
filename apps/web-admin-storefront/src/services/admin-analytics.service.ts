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
   * Build a downloadable CSV URL for the given report. Returned as a
   * full URL so the browser can hit it directly with `<a download>`
   * (apiClient would try to JSON-parse and fail for CSV).
   */
  csvUrl(
    report: 'sales-daily' | 'top-products' | 'bottom-products' | 'order-status-mix',
    start: string,
    end: string,
  ): string {
    return `${API_BASE}/admin/analytics/export/${report}.csv${buildQs({ start, end })}`;
  },
};

export function inr(n: number): string {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
export function inrFromPaise(p: number): string {
  return inr(p / 100);
}
