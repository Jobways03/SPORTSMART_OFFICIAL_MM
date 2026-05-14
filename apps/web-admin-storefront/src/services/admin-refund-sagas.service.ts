import { apiClient, ApiResponse } from '@/lib/api-client';

export type RefundSagaStatus =
  | 'STARTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'COMPENSATED';

export interface RefundSagaRow {
  id: string;
  refundType: string;
  sourceId: string;
  instructionId: string | null;
  // BigInt-as-string from the server — keep as string for precision.
  amountInPaise: string;
  customerId: string;
  status: RefundSagaStatus;
  steps: unknown;
  compensations: unknown;
  startedAt: string;
  completedAt: string | null;
  failureReason: string | null;
  ageMs: number;
}

export interface RefundSagaListResponse {
  items: RefundSagaRow[];
  total: number;
  page: number;
  limit: number;
}

export interface RefundSagaFilters {
  status?: string;
  stuckOnly?: boolean;
  page?: number;
  limit?: number;
}

function buildQs(filters: RefundSagaFilters): string {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.stuckOnly) qs.set('stuckOnly', 'true');
  if (filters.page) qs.set('page', String(filters.page));
  if (filters.limit) qs.set('limit', String(filters.limit));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const adminRefundSagasService = {
  list(filters: RefundSagaFilters = {}): Promise<ApiResponse<RefundSagaListResponse>> {
    return apiClient<RefundSagaListResponse>(`/admin/refund-sagas${buildQs(filters)}`);
  },

  getOne(id: string): Promise<ApiResponse<RefundSagaRow>> {
    return apiClient<RefundSagaRow>(`/admin/refund-sagas/${id}`);
  },
};
