import { apiClient, ApiResponse } from '@/lib/api-client';

export interface SlotDefinition {
  id: string;
  sectionKey: string;
  slotKey: string;
  label: string;
  position: number;
  defaultHref: string | null;
  isSystem: boolean;
}

export interface CreateSlotInput {
  sectionKey: string;
  slotKey?: string;
  label: string;
  defaultHref?: string | null;
  position?: number;
}

export const adminStorefrontSlotsService = {
  list(): Promise<ApiResponse<{ items: SlotDefinition[] }>> {
    return apiClient('/admin/storefront-slots');
  },

  create(body: CreateSlotInput): Promise<ApiResponse<SlotDefinition>> {
    return apiClient('/admin/storefront-slots', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  },

  remove(id: string): Promise<ApiResponse<null>> {
    return apiClient(`/admin/storefront-slots/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
};
