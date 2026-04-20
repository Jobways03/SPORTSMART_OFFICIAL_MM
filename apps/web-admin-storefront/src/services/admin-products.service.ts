import { apiClient, ApiResponse, ApiError } from '@/lib/api-client';

export interface ProductListItem {
  id: string;
  title: string;
  slug: string;
  status: string;
  moderationStatus: string;
  moderationNote: string | null;
  hasVariants: boolean;
  basePrice: string | null;
  baseStock: number | null;
  totalStock: number;
  primaryImageUrl: string | null;
  variantCount: number;
  seller: { id: string; sellerName: string; sellerShopName: string; email: string; } | null;
  category: { id: string; name: string; } | null;
  brand: { id: string; name: string; } | null;
  potentialDuplicateOf: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListResponse {
  products: ProductListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number; };
}

export interface ProductDetail extends ProductListItem {
  shortDescription: string | null;
  description: string | null;
  categoryId: string | null;
  brandId: string | null;
  platformPrice: string | null;
  compareAtPrice: string | null;
  costPrice: string | null;
  baseSku: string | null;
  baseBarcode: string | null;
  weight: string | null;
  weightUnit: string | null;
  length: string | null;
  width: string | null;
  height: string | null;
  dimensionUnit: string | null;
  returnPolicy: string | null;
  warrantyInfo: string | null;
  variants: any[];
  images: any[];
  tags: { id: string; tag: string; }[];
  seo: { metaTitle: string | null; metaDescription: string | null; handle: string | null; } | null;
}

export interface ListProductsParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  moderationStatus?: string;
  categoryId?: string;
  sellerId?: string;
}

export const adminProductsService = {
  listProducts(params: ListProductsParams = {}): Promise<ApiResponse<ProductListResponse>> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) query.set(k, String(v)); });
    const qs = query.toString();
    return apiClient<ProductListResponse>(`/admin/products${qs ? `?${qs}` : ''}`);
  },

  getProduct(productId: string): Promise<ApiResponse<ProductDetail>> {
    return apiClient<ProductDetail>(`/admin/products/${productId}`);
  },

  createProduct(payload: Record<string, unknown>): Promise<ApiResponse<ProductDetail>> {
    return apiClient<ProductDetail>('/admin/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateProduct(productId: string, payload: Record<string, unknown>): Promise<ApiResponse<ProductDetail>> {
    return apiClient<ProductDetail>(`/admin/products/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  deleteProduct(productId: string): Promise<ApiResponse> {
    return apiClient(`/admin/products/${productId}`, { method: 'DELETE' });
  },

  approveProduct(productId: string): Promise<ApiResponse> {
    return apiClient(`/admin/products/${productId}/approve`, { method: 'PATCH' });
  },

  rejectProduct(productId: string, reason: string): Promise<ApiResponse> {
    return apiClient(`/admin/products/${productId}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  requestChanges(productId: string, note: string): Promise<ApiResponse> {
    return apiClient(`/admin/products/${productId}/request-changes`, {
      method: 'PATCH',
      body: JSON.stringify({ note }),
    });
  },

  bulkApprove(
    productIds: string[],
  ): Promise<ApiResponse<{ ok: string[]; failed: Array<{ id: string; reason: string }> }>> {
    return apiClient('/admin/products/bulk/approve', {
      method: 'POST',
      body: JSON.stringify({ productIds }),
    });
  },

  bulkReject(
    productIds: string[],
    reason: string,
  ): Promise<ApiResponse<{ ok: string[]; failed: Array<{ id: string; reason: string }> }>> {
    return apiClient('/admin/products/bulk/reject', {
      method: 'POST',
      body: JSON.stringify({ productIds, reason }),
    });
  },

  bulkRequestChanges(
    productIds: string[],
    note: string,
  ): Promise<ApiResponse<{ ok: string[]; failed: Array<{ id: string; reason: string }> }>> {
    return apiClient('/admin/products/bulk/request-changes', {
      method: 'POST',
      body: JSON.stringify({ productIds, note }),
    });
  },

  updateStatus(productId: string, status: string, reason?: string): Promise<ApiResponse> {
    return apiClient(`/admin/products/${productId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    });
  },

  // Duplicate detection & merge
  mergeProduct(sourceProductId: string, targetProductId: string): Promise<ApiResponse> {
    return apiClient(`/admin/products/${sourceProductId}/merge-into/${targetProductId}`, {
      method: 'POST',
    });
  },

  getDuplicateInfo(productId: string): Promise<ApiResponse<any>> {
    return apiClient<any>(`/admin/products/${productId}/duplicate-info`);
  },

  // Public catalog endpoints (no auth)
  getCategories(): Promise<ApiResponse<any>> {
    return apiClient('/catalog/categories');
  },

  getBrands(search?: string): Promise<ApiResponse<any>> {
    return apiClient(`/catalog/brands${search ? `?search=${search}` : ''}`);
  },

  getOptions(): Promise<ApiResponse<any>> {
    return apiClient<any>('/catalog/options', {
      method: 'GET',
    });
  },

  // Variant methods
  createVariant(productId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
    return apiClient<any>(`/admin/products/${productId}/variants`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  generateManualVariants(productId: string, options: { name: string; values: string[] }[]): Promise<ApiResponse<any>> {
    return apiClient<any>(`/admin/products/${productId}/variants/generate-manual`, {
      method: 'POST',
      body: JSON.stringify({ options }),
    });
  },

  updateVariant(productId: string, variantId: string, payload: Record<string, unknown>): Promise<ApiResponse<any>> {
    return apiClient<any>(`/admin/products/${productId}/variants/${variantId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  bulkUpdateVariants(productId: string, variants: Record<string, unknown>[]): Promise<ApiResponse<any>> {
    return apiClient<any>(`/admin/products/${productId}/variants/bulk`, {
      method: 'PATCH',
      body: JSON.stringify({ variants }),
    });
  },

  deleteVariant(productId: string, variantId: string): Promise<ApiResponse> {
    return apiClient(`/admin/products/${productId}/variants/${variantId}`, { method: 'DELETE' });
  },

  // Image methods
  uploadImage(productId: string, file: File): Promise<ApiResponse<any>> {
    const formData = new FormData();
    formData.append('image', file);
    return apiClient(`/admin/products/${productId}/images`, {
      method: 'POST',
      body: formData,
    });
  },

  deleteImage(productId: string, imageId: string): Promise<ApiResponse> {
    return apiClient(`/admin/products/${productId}/images/${imageId}`, { method: 'DELETE' });
  },

  reorderImages(productId: string, imageIds: string[]): Promise<ApiResponse> {
    return apiClient(`/admin/products/${productId}/images/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ imageIds }),
    });
  },

  // Variant image methods
  uploadVariantImage(productId: string, variantId: string, file: File): Promise<ApiResponse<any>> {
    const formData = new FormData();
    formData.append('image', file);
    return apiClient(
      `/admin/products/${productId}/variants/${variantId}/images`,
      { method: 'POST', body: formData },
    );
  },

  deleteVariantImage(productId: string, variantId: string, imageId: string): Promise<ApiResponse> {
    return apiClient(`/admin/products/${productId}/variants/${variantId}/images/${imageId}`, { method: 'DELETE' });
  },

  reorderVariantImages(productId: string, variantId: string, imageIds: string[]): Promise<ApiResponse> {
    return apiClient(`/admin/products/${productId}/variants/${variantId}/images/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ imageIds }),
    });
  },

  // ─── Admin Categories CRUD ──────────────────────────────────────

  listAdminCategories(params?: { page?: number; limit?: number; search?: string; parentId?: string }): Promise<ApiResponse<any>> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.search) qs.set('search', params.search);
    if (params?.parentId) qs.set('parentId', params.parentId);
    const q = qs.toString();
    return apiClient(`/admin/categories${q ? '?' + q : ''}`);
  },

  createCategory(payload: { name: string; parentId?: string; description?: string; sortOrder?: number }): Promise<ApiResponse<any>> {
    return apiClient('/admin/categories', { method: 'POST', body: JSON.stringify(payload) });
  },

  updateCategory(id: string, payload: any): Promise<ApiResponse<any>> {
    return apiClient(`/admin/categories/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },

  deleteCategory(id: string): Promise<ApiResponse<any>> {
    return apiClient(`/admin/categories/${id}`, { method: 'DELETE' });
  },

  // ─── Admin Brands CRUD ──────────────────────────────────────────

  listAdminBrands(params?: { page?: number; limit?: number; search?: string }): Promise<ApiResponse<any>> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.search) qs.set('search', params.search);
    const q = qs.toString();
    return apiClient(`/admin/brands${q ? '?' + q : ''}`);
  },

  createBrand(payload: { name: string }): Promise<ApiResponse<any>> {
    return apiClient('/admin/brands', { method: 'POST', body: JSON.stringify(payload) });
  },

  updateBrand(id: string, payload: any): Promise<ApiResponse<any>> {
    return apiClient(`/admin/brands/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },

  deleteBrand(id: string): Promise<ApiResponse<any>> {
    return apiClient(`/admin/brands/${id}`, { method: 'DELETE' });
  },

  getAdminBrand(id: string): Promise<ApiResponse<any>> {
    return apiClient(`/admin/brands/${id}`);
  },

  addProductsToBrand(brandId: string, productIds: string[]): Promise<ApiResponse<any>> {
    return apiClient(`/admin/brands/${brandId}/products`, { method: 'POST', body: JSON.stringify({ productIds }) });
  },

  removeProductFromBrand(brandId: string, productId: string): Promise<ApiResponse<any>> {
    return apiClient(`/admin/brands/${brandId}/products/${productId}`, { method: 'DELETE' });
  },
};
