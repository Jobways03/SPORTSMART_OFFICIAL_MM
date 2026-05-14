import { apiClient, ApiResponse } from '@/lib/api-client';

export interface BrandListItem {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  logoUrl?: string | null;
  logoPublicId?: string | null;
  isActive?: boolean;
  productCount?: number;
  _count?: { products: number };
}

export interface BrandDetail extends BrandListItem {
  description?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface BrandWriteInput {
  name: string;
  slug?: string;
  description?: string | null;
  isActive?: boolean;
  metaTitle?: string | null;
  metaDescription?: string | null;
}

export interface BrandListResponse {
  brands: BrandListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Centralised brand admin client. Previously only `list()` was here
// and the BrandForm scattered raw `apiClient` calls inline — moving
// everything through this service makes the audit surface match the
// actual capability and gives one place to evolve the contract.
export const adminBrandsService = {
  list(args: { page?: number; limit?: number; search?: string } = {}): Promise<
    ApiResponse<BrandListResponse>
  > {
    const qs = new URLSearchParams();
    if (args.page) qs.set('page', String(args.page));
    qs.set('limit', String(args.limit ?? 100));
    if (args.search) qs.set('search', args.search);
    return apiClient<BrandListResponse>(`/admin/brands?${qs.toString()}`);
  },

  getOne(id: string): Promise<ApiResponse<{ brand: BrandDetail }>> {
    return apiClient<{ brand: BrandDetail }>(`/admin/brands/${id}`);
  },

  create(body: BrandWriteInput): Promise<ApiResponse<{ brand: BrandDetail }>> {
    return apiClient<{ brand: BrandDetail }>('/admin/brands', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  update(
    id: string,
    body: Partial<BrandWriteInput>,
  ): Promise<ApiResponse<{ brand: BrandDetail }>> {
    return apiClient<{ brand: BrandDetail }>(`/admin/brands/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  remove(id: string): Promise<ApiResponse<{ deleted: true }>> {
    return apiClient(`/admin/brands/${id}`, { method: 'DELETE' });
  },

  // Logo upload uses multipart/form-data — apiClient passes the FormData
  // through and skips its default JSON Content-Type when the body is
  // a FormData instance. Returns the new logoUrl.
  uploadLogo(id: string, file: File): Promise<ApiResponse<{ logoUrl: string }>> {
    const form = new FormData();
    form.append('file', file);
    return apiClient<{ logoUrl: string }>(`/admin/brands/${id}/logo`, {
      method: 'POST',
      body: form as any,
    });
  },

  removeLogo(id: string): Promise<ApiResponse<{ deleted: true }>> {
    return apiClient(`/admin/brands/${id}/logo`, { method: 'DELETE' });
  },

  attachProduct(brandId: string, productId: string): Promise<ApiResponse<void>> {
    return apiClient(`/admin/brands/${brandId}/products`, {
      method: 'POST',
      body: JSON.stringify({ productId }),
    });
  },

  detachProduct(brandId: string, productId: string): Promise<ApiResponse<void>> {
    return apiClient(`/admin/brands/${brandId}/products/${productId}`, {
      method: 'DELETE',
    });
  },
};
