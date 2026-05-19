import { apiClient, ApiResponse, ApiError } from '@/lib/api-client';

export interface ProductInventorySummary {
  totalStock: number;
  totalAvailable: number;
  totalReserved: number;
  sellerCount: number;
  franchiseCount: number;
  lowStockCount: number;
}

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
  productCode: string | null;
  seller: { id: string; sellerName: string; sellerShopName: string; email: string; } | null;
  category: { id: string; name: string; } | null;
  brand: { id: string; name: string; } | null;
  createdAt: string;
  updatedAt: string;
  // Phase 37 — surfaced on the list so the admin moderation queue
  // can render an "unverified tax config" badge without a per-row
  // fetch. Backend uses `include` (not `select`) so all Product
  // columns flow into the response — we just type-narrow here.
  taxConfigVerified?: boolean;
  // Pre-aggregated server-side so the list view can render an inline
  // inventory snapshot without per-row API calls.
  inventorySummary?: ProductInventorySummary;
}

export interface ProductListResponse {
  products: ProductListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number; };
}

export interface ProductDetail extends ProductListItem {
  sellerId: string | null;
  shortDescription: string | null;
  description: string | null;
  categoryId: string | null;
  brandId: string | null;
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
  // Tax fields — see catalog.prisma Product (Phase 1 GST). The API
  // returns them on every product detail; surfacing them in the type
  // lets the edit form populate without `(p as any)` casts.
  hsnCode: string | null;
  gstRateBps: number;
  supplyTaxability:
    | 'TAXABLE'
    | 'NIL_RATED'
    | 'EXEMPT'
    | 'NON_GST'
    | 'ZERO_RATED'
    | 'OUT_OF_SCOPE';
  taxInclusivePricing: boolean;
  cessRateBps: number;
  defaultUqcCode: string | null;
  taxCategory: string | null;
  // Phase 37 — admin tax-config attestation. Seller-proposed tax
  // fields land with this false; an admin POSTs /verify-tax-config
  // to flip it true. Any subsequent edit to a tax field auto-resets
  // it. STRICT-mode invoicing should gate on this.
  taxConfigVerified: boolean;
  taxConfigVerifiedAt: string | null;
  taxConfigVerifiedBy: string | null;
  taxConfigUpdatedAt: string | null;
  taxConfigUpdatedBy: string | null;
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
  hasSellers?: string;
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

  // Phase 37 — admin attestation of the product's tax config (HSN,
  // GST rate, supply taxability, etc.). Separate from approveProduct
  // which only flips catalog moderation status; tax-config is a
  // finance/compliance signoff that gates STRICT-mode invoicing.
  verifyProductTaxConfig(
    productId: string,
  ): Promise<
    ApiResponse<{
      taxConfigVerified: boolean;
      taxConfigVerifiedAt: string;
      taxConfigVerifiedBy: string;
    }>
  > {
    return apiClient(`/admin/products/${productId}/verify-tax-config`, {
      method: 'PATCH',
    });
  },

  // Phase 37 — bulk tax-config update across many products.
  bulkUpdateTaxConfig(input: {
    productIds?: string[];
    categoryId?: string | null;
    missingHsnOnly?: boolean;
    hsnCode?: string | null;
    gstRateBps?: number;
    supplyTaxability?: string;
    defaultUqcCode?: string | null;
  }): Promise<ApiResponse<{ updated: number }>> {
    return apiClient('/admin/products/bulk/tax-config', {
      method: 'POST',
      body: JSON.stringify(input),
    });
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

  updateStatus(productId: string, status: string, reason?: string): Promise<ApiResponse> {
    return apiClient(`/admin/products/${productId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    });
  },

  // Seller mapping approval endpoints
  getSellerMappings(productId: string): Promise<ApiResponse<any>> {
    return apiClient<any>(`/admin/products/${productId}/seller-mappings`);
  },

  approveMappings(mappingId: string): Promise<ApiResponse> {
    return apiClient(`/admin/seller-mappings/${mappingId}/approve`, { method: 'POST' });
  },

  stopMapping(mappingId: string): Promise<ApiResponse> {
    return apiClient(`/admin/seller-mappings/${mappingId}/stop`, { method: 'POST' });
  },

  getPendingMappings(params: { page?: number; limit?: number } = {}): Promise<ApiResponse<any>> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    const qs = query.toString();
    return apiClient<any>(`/admin/seller-mappings/pending${qs ? `?${qs}` : ''}`);
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
};
