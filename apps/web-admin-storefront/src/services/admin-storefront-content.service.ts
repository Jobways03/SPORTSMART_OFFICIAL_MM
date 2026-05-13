import { apiClient, ApiResponse, API_BASE } from '@/lib/api-client';

export interface StorefrontContentBlock {
  slot: string;
  imageUrl: string | null;
  eyebrow: string | null;
  headline: string | null;
  subhead: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  price: string | null;
  priceCaption: string | null;
  active: boolean;
  updatedAt: string;
}

export interface UpsertBlockInput {
  imageUrl?: string | null;
  eyebrow?: string | null;
  headline?: string | null;
  subhead?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  price?: string | null;
  priceCaption?: string | null;
  active?: boolean;
}

export const adminStorefrontContentService = {
  list(): Promise<ApiResponse<{ items: StorefrontContentBlock[] }>> {
    return apiClient('/admin/storefront-content');
  },

  getOne(slot: string): Promise<ApiResponse<StorefrontContentBlock | null>> {
    return apiClient(`/admin/storefront-content/${encodeURIComponent(slot)}`);
  },

  upsert(
    slot: string,
    body: UpsertBlockInput,
  ): Promise<ApiResponse<StorefrontContentBlock>> {
    return apiClient(`/admin/storefront-content/${encodeURIComponent(slot)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  },

  reset(slot: string): Promise<ApiResponse<null>> {
    return apiClient(`/admin/storefront-content/${encodeURIComponent(slot)}`, {
      method: 'DELETE',
    });
  },

  /**
   * Multipart upload. We use fetch directly here because apiClient
   * sets Content-Type: application/json by default, which would break
   * multipart boundary auto-generation. The auth header is read from
   * the same localStorage key the rest of the admin app uses.
   */
  async uploadImage(
    slot: string,
    file: File,
  ): Promise<ApiResponse<StorefrontContentBlock>> {
    const form = new FormData();
    form.append('image', file);
    const token =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem('adminAccessToken')
        : null;
    const res = await fetch(
      `${API_BASE}/api/v1/admin/storefront-content/${encodeURIComponent(slot)}/upload`,
      {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      },
    );
    const json = await res.json();
    if (!res.ok) {
      const err = json?.message ?? `Upload failed (${res.status})`;
      throw new Error(Array.isArray(err) ? err.join(', ') : err);
    }
    return json;
  },
};
