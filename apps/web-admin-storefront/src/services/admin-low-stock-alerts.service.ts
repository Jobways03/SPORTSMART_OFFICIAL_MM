import { apiClient, ApiResponse } from '@/lib/api-client';

export interface LowStockAlert {
  id: string;
  sellerProductMappingId: string;
  sellerId: string;
  productId: string;
  currentStock: number;
  threshold: number;
  resolvedAt: string | null;
  createdAt: string;
}

export interface LowStockSweepResult {
  created: number;
  resolved: number;
}

export const adminLowStockAlertsService = {
  /** GET /admin/inventory/alerts — list OPEN (unresolved) low-stock alerts. */
  list(params: { sellerId?: string; limit?: number } = {}): Promise<
    ApiResponse<LowStockAlert[]>
  > {
    const qs = new URLSearchParams();
    if (params.sellerId) qs.set('sellerId', params.sellerId);
    if (params.limit) qs.set('limit', String(params.limit));
    const tail = qs.toString();
    return apiClient<LowStockAlert[]>(
      `/admin/inventory/alerts${tail ? `?${tail}` : ''}`,
    );
  },

  /**
   * POST /admin/inventory/alerts/sweep — recompute open alerts.
   * Cron does this every 15 min; this endpoint lets an admin trigger
   * it on demand after a bulk price/threshold change.
   */
  sweep(): Promise<ApiResponse<LowStockSweepResult>> {
    return apiClient<LowStockSweepResult>('/admin/inventory/alerts/sweep', {
      method: 'POST',
    });
  },
};
