import { apiClient, ApiResponse } from '@/lib/api-client';

export interface FranchiseReturnItem {
  id: string;
  quantity?: number;
  reasonCategory?: string | null;
  orderItem?: {
    productTitle?: string | null;
    sku?: string | null;
    imageUrl?: string | null;
  } | null;
}

export interface FranchiseReturnListItem {
  id: string;
  returnNumber?: string | null;
  status: string;
  createdAt: string;
  totalRefundAmount?: string | number | null;
  refundAmount?: string | number | null;
  items?: FranchiseReturnItem[];
  subOrder?: {
    id?: string;
    masterOrder?: { orderNumber?: string } | null;
  } | null;
}

export interface FranchiseReturnDetail extends FranchiseReturnListItem {
  reason?: string | null;
  refundStatus?: string | null;
  evidence?: Array<{
    id: string;
    url?: string | null;
    viewUrl?: string | null;
    description?: string | null;
  }>;
  statusHistory?: Array<{
    id: string;
    status: string;
    note?: string | null;
    createdAt: string;
  }>;
  customer?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  } | null;
}

export const franchiseReturnsService = {
  list(
    franchiseId: string,
    params: { page?: number; limit?: number; status?: string } = {},
  ): Promise<
    ApiResponse<{ returns: FranchiseReturnListItem[]; total: number }>
  > {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.status) qs.set('status', params.status);
    const q = qs.toString();
    return apiClient(
      `/admin/franchise-returns/franchises/${franchiseId}${q ? `?${q}` : ''}`,
    );
  },

  get(
    returnId: string,
    franchiseId: string,
  ): Promise<ApiResponse<FranchiseReturnDetail>> {
    return apiClient(
      `/admin/franchise-returns/${returnId}?franchiseId=${encodeURIComponent(franchiseId)}`,
    );
  },
};
