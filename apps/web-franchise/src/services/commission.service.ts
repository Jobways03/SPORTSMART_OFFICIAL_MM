import { apiClient, ApiResponse } from '@/lib/api-client';

export interface FranchiseCommissionRecord {
  id: string;
  subOrderId: string;
  orderNumber: string;
  orderStatus: string | null;
  productTitle: string;
  variantTitle: string | null;
  itemCount: number;
  totalQuantity: number;
  baseAmount: number;
  rate: number;
  computedAmount: number;
  platformEarning: number;
  franchiseEarning: number;
  status: string;
  createdAt: string;
}

export interface CommissionListResponse {
  records: FranchiseCommissionRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CommissionListParams {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
}

export const franchiseCommissionService = {
  list(params: CommissionListParams = {}): Promise<ApiResponse<CommissionListResponse>> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    if (params.fromDate) query.set('fromDate', params.fromDate);
    if (params.toDate) query.set('toDate', params.toDate);
    const qs = query.toString();
    return apiClient<CommissionListResponse>(
      `/franchise/earnings/commission${qs ? `?${qs}` : ''}`,
    );
  },
};
