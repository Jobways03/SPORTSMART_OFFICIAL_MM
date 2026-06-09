import { apiClient, ApiResponse } from '@/lib/api-client';

// Mirrors backend AdminFlashSalesController (/admin/flash-sales).
// Reads → content.read, writes (create / update / delete) → content.write.
// Flash sales are curated, time-boxed storefront sales: a title/subtitle, an
// active window, an optional members-only gate and an optional linked
// collection. There is no discount-% field — the saving is expressed through
// the merchandised collection.
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

export interface FlashSaleWriteInput {
  title: string;
  subtitle?: string | null;
  startsAt: string;
  endsAt: string;
  membersOnly?: boolean;
  collectionSlug?: string | null;
  isActive?: boolean;
}

export const flashSalesService = {
  list(): Promise<ApiResponse<any>> {
    return apiClient<any>('/admin/flash-sales?limit=100');
  },
  get(id: string): Promise<ApiResponse<FlashSale>> {
    return apiClient<FlashSale>(`/admin/flash-sales/${id}`);
  },
  create(body: FlashSaleWriteInput): Promise<ApiResponse<FlashSale>> {
    return apiClient<FlashSale>('/admin/flash-sales', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  update(
    id: string,
    body: Partial<FlashSaleWriteInput>,
  ): Promise<ApiResponse<FlashSale>> {
    return apiClient<FlashSale>(`/admin/flash-sales/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  remove(id: string): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/flash-sales/${id}`, { method: 'DELETE' });
  },
};
