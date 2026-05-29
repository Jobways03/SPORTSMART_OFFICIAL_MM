import { apiClient, ApiResponse } from '@/lib/api-client';

// Mirrors apps/api/src/modules/marketing/marketing.service.ts FlashSaleDto.
// Kept in sync manually — when the backend DTO changes, this file
// changes alongside it (typecheck on the consuming pages will flag
// any drift the moment a field is referenced).
export interface FlashSale {
  id: string;
  title: string;
  subtitle: string | null;
  startsAt: string;
  endsAt: string;
  membersOnly: boolean;
  collectionSlug: string | null;
  waitlistCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFlashSaleInput {
  title: string;
  subtitle?: string;
  startsAt: string;
  endsAt: string;
  membersOnly?: boolean;
  collectionSlug?: string;
  waitlistCount?: number;
  isActive?: boolean;
}

export type UpdateFlashSaleInput = Partial<CreateFlashSaleInput>;

export interface FlashSaleListResponse {
  items: FlashSale[];
  total: number;
  page: number;
  limit: number;
}

export const adminFlashSalesService = {
  list(params: { page?: number; limit?: number } = {}): Promise<
    ApiResponse<FlashSaleListResponse>
  > {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    const s = qs.toString();
    return apiClient<FlashSaleListResponse>(
      `/admin/flash-sales${s ? `?${s}` : ''}`,
    );
  },

  get(id: string): Promise<ApiResponse<FlashSale>> {
    return apiClient<FlashSale>(`/admin/flash-sales/${id}`);
  },

  create(input: CreateFlashSaleInput): Promise<ApiResponse<FlashSale>> {
    return apiClient<FlashSale>('/admin/flash-sales', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  update(
    id: string,
    input: UpdateFlashSaleInput,
  ): Promise<ApiResponse<FlashSale>> {
    return apiClient<FlashSale>(`/admin/flash-sales/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  remove(id: string): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/flash-sales/${id}`, { method: 'DELETE' });
  },
};
