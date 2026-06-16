/**
 * Phase 32 (2026-05-21) — cookie-auth migration (transitional step).
 *
 * Pre-Phase-32 every method explicitly forwarded `Authorization:
 * Bearer ${token}` from a `token` parameter the caller had read from
 * sessionStorage. The shared `@/lib/api-client` (from
 * `@sportsmart/shared-utils`) already:
 *   - Sends `credentials: 'include'` so the httpOnly cookie set on
 *     login authenticates the request.
 *   - Auto-reads `sessionStorage.getItem('accessToken')` and stamps
 *     it as a Bearer header when the cookie is unavailable
 *     (transitional fallback during the cookie-auth rollout).
 *
 * The explicit `headers: { Authorization: ... }` per-call was
 * redundant — it overwrote the apiClient's own auto-Bearer with the
 * same value. Removing it lets the request flow through the
 * apiClient's standard auth pipeline. The `token` parameter is kept
 * for backwards compatibility with the ~20 existing call-sites; once
 * every caller drops the argument the param can be removed entirely.
 *
 * This is the safe first step of the cookie-only migration: no
 * caller breaks, no behaviour change, but the explicit token
 * plumbing no longer perpetuates the sessionStorage dependency.
 */
import { apiClient, ApiError, ApiResponse } from '@/lib/api-client';


// ===== Interfaces =====

export interface ListProductsParams {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  categoryId?: string;
}

export interface ProductListResponse {
  products: ProductListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface ProductListItem {
  id: string;
  title: string;
  slug: string;
  status: string;
  moderationStatus: string;
  // Phase 32 (2026-05-21) — `moderationNote` is the legacy column.
  // The canonical fields are `rejectionReason` (REJECTED) +
  // `changeRequestNote` (CHANGES_REQUESTED). All renderers should
  // prefer the structured field, falling back to moderationNote
  // for rows written before the dual-write landed.
  moderationNote: string | null;
  rejectionReason: string | null;
  changeRequestNote: string | null;
  hasVariants: boolean;
  basePrice: string | null;
  baseStock: number | null;
  categoryName: string | null;
  brandName: string | null;
  primaryImageUrl: string | null;
  variantCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDetail {
  id: string;
  title: string;
  slug: string;
  productCode: string | null;
  shortDescription: string | null;
  description: string | null;
  categoryId: string | null;
  brandId: string | null;
  status: string;
  moderationStatus: string;
  // Phase 32 — see ProductListItem for the dual-field rationale.
  moderationNote: string | null;
  rejectionReason: string | null;
  changeRequestNote: string | null;
  hasVariants: boolean;
  basePrice: string | null;
  compareAtPrice: string | null;
  costPrice: string | null;
  baseSku: string | null;
  baseStock: number | null;
  baseBarcode: string | null;
  weight: string | null;
  weightUnit: string | null;
  length: string | null;
  width: string | null;
  height: string | null;
  dimensionUnit: string | null;
  returnPolicy: string | null;
  warrantyInfo: string | null;
  // Tax fields — see catalog.prisma Product (Phase 1 GST). Mirrors the
  // backend create/update DTOs (CreateProductDto / UpdateProductDto).
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
  category: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  variants: ProductVariant[];
  images: ProductImage[];
  tags: { id: string; tag: string }[];
  seo: { metaTitle: string | null; metaDescription: string | null; handle: string | null } | null;
  statusHistory?: { id: string; fromStatus: string | null; toStatus: string; reason: string | null; createdAt: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariant {
  id: string;
  title: string | null;
  sku: string | null;
  masterSku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  costPrice: string | null;
  stock: number;
  weight: string | null;
  weightUnit: string | null;
  status: string;
  optionValues: { id: string; value: string; displayValue: string; optionName: string }[];
  images: ProductVariantImage[];
}

export interface ProductVariantImage {
  id: string;
  variantId: string;
  url: string;
  publicId: string | null;
  altText: string | null;
  sortOrder: number;
}

export interface ProductImage {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

export interface CreateProductPayload {
  title: string;
  categoryId?: string;
  brandId?: string;
  categoryName?: string;
  brandName?: string;
  shortDescription?: string;
  description?: string;
  hasVariants?: boolean;
  basePrice?: number;
  compareAtPrice?: number;
  costPrice?: number;
  baseSku?: string;
  baseStock?: number;
  baseBarcode?: string;
  weight?: number;
  weightUnit?: string;
  length?: number;
  width?: number;
  height?: number;
  dimensionUnit?: string;
  returnPolicy?: string;
  warrantyInfo?: string;
  tags?: string[];
  seo?: { metaTitle?: string; metaDescription?: string; handle?: string };
}

export type UpdateProductPayload = Partial<CreateProductPayload>;

// ===== Service =====

export const sellerProductService = {
  listProducts(token: string, params: ListProductsParams = {}): Promise<ApiResponse<ProductListResponse>> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    if (params.categoryId) query.set('categoryId', params.categoryId);
    const qs = query.toString();
    return apiClient<ProductListResponse>(`/seller/products${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    });
  },

  getProduct(token: string, productId: string): Promise<ApiResponse<ProductDetail>> {
    return apiClient<ProductDetail>(`/seller/products/${productId}`, {
      method: 'GET',
    });
  },

  createProduct(token: string, payload: CreateProductPayload): Promise<ApiResponse<ProductDetail>> {
    return apiClient<ProductDetail>('/seller/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateProduct(token: string, productId: string, payload: UpdateProductPayload): Promise<ApiResponse<ProductDetail>> {
    return apiClient<ProductDetail>(`/seller/products/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  deleteProduct(token: string, productId: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/seller/products/${productId}`, {
      method: 'DELETE',
    });
  },

  submitForReview(token: string, productId: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/seller/products/${productId}/submit`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  // 2026-06-15 — setSelfStatus (product-level pause) removed: pausing the
  // shared product stopped sales for ALL sellers. Per-seller pause is pauseSales
  // / resumeSales above.

  generateVariants(token: string, productId: string, optionValueIds: string[][]): Promise<ApiResponse<any>> {
    return apiClient<any>(`/seller/products/${productId}/variants/generate`, {
      method: 'POST',
      body: JSON.stringify({ optionValueIds }),
    });
  },

  generateManualVariants(token: string, productId: string, options: { name: string; values: string[] }[]): Promise<ApiResponse<any>> {
    return apiClient<any>(`/seller/products/${productId}/variants/generate-manual`, {
      method: 'POST',
      body: JSON.stringify({ options }),
    });
  },

  updateVariant(token: string, productId: string, variantId: string, payload: any): Promise<ApiResponse<any>> {
    return apiClient<any>(`/seller/products/${productId}/variants/${variantId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  bulkUpdateVariants(token: string, productId: string, variants: any[]): Promise<ApiResponse<any>> {
    return apiClient<any>(`/seller/products/${productId}/variants/bulk`, {
      method: 'PATCH',
      body: JSON.stringify({ variants }),
    });
  },

  createVariant(token: string, productId: string, payload: any): Promise<ApiResponse<any>> {
    return apiClient<any>(`/seller/products/${productId}/variants`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  deleteVariant(token: string, productId: string, variantId: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/seller/products/${productId}/variants/${variantId}`, {
      method: 'DELETE',
    });
  },

  uploadImage(token: string, productId: string, file: File): Promise<ApiResponse<any>> {
    const formData = new FormData();
    formData.append('image', file);
    return apiClient<any>(`/seller/products/${productId}/images`, {
      method: 'POST',
      body: formData,
    });
  },

  deleteImage(token: string, productId: string, imageId: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/seller/products/${productId}/images/${imageId}`, {
      method: 'DELETE',
    });
  },

  reorderImages(token: string, productId: string, imageIds: string[]): Promise<ApiResponse<void>> {
    return apiClient<void>(`/seller/products/${productId}/images/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ imageIds }),
    });
  },

  getCategories(): Promise<ApiResponse<any>> {
    return apiClient<any>('/catalog/categories', {
      method: 'GET',
    });
  },

  getCategoryOptions(categoryId: string): Promise<ApiResponse<any>> {
    return apiClient<any>(`/catalog/categories/${categoryId}/options`, {
      method: 'GET',
    });
  },

  getBrands(search?: string): Promise<ApiResponse<any>> {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return apiClient<any>(`/catalog/brands${qs}`, {
      method: 'GET',
    });
  },

  uploadVariantImage(token: string, productId: string, variantId: string, file: File): Promise<ApiResponse<any>> {
    const formData = new FormData();
    formData.append('image', file);
    return apiClient<any>(
      `/seller/products/${productId}/variants/${variantId}/images`,
      {
        method: 'POST',
          body: formData,
      },
    );
  },

  deleteVariantImage(token: string, productId: string, variantId: string, imageId: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/seller/products/${productId}/variants/${variantId}/images/${imageId}`, {
      method: 'DELETE',
    });
  },

  reorderVariantImages(token: string, productId: string, variantId: string, imageIds: string[]): Promise<ApiResponse<void>> {
    return apiClient<void>(`/seller/products/${productId}/variants/${variantId}/images/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ imageIds }),
    });
  },

  getOptions(): Promise<ApiResponse<any>> {
    return apiClient<any>('/catalog/options', {
      method: 'GET',
    });
  },

  // Catalog browsing & mapping
  browseCatalog(token: string, params: { page?: number; limit?: number; search?: string }): Promise<ApiResponse<any>> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.search) qs.set('search', params.search);
    return apiClient<any>(`/seller/catalog/browse?${qs}`, {
      method: 'GET',
    });
  },

  mapToProduct(token: string, payload: any): Promise<ApiResponse<any>> {
    return apiClient<any>('/seller/catalog/map', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getMyMappedProducts(token: string, params: { page?: number; limit?: number; search?: string }): Promise<ApiResponse<any>> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.search) qs.set('search', params.search);
    return apiClient<any>(`/seller/catalog/my-products?${qs}`, {
      method: 'GET',
    });
  },

  updateMapping(token: string, mappingId: string, payload: any): Promise<ApiResponse<any>> {
    return apiClient<any>(`/seller/catalog/mapping/${mappingId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  // Seller-initiated pause (deactivate). Sets the mapping STOPPED +
  // isActive=false and releases its reservations. Re-activation requires
  // admin re-approval — the PATCH update endpoint forbids `isActive`.
  pauseMapping(token: string, mappingId: string, reason: string): Promise<ApiResponse<any>> {
    return apiClient<any>(`/seller/catalog/mapping/${mappingId}/pause`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  // 2026-06-15 — pause/resume THIS seller's offer for a whole product (all
  // variants) from My Products. Only this seller's mappings change; other
  // sellers keep selling and the shared product stays live.
  pauseSales(token: string, productId: string, reason?: string): Promise<ApiResponse<any>> {
    return apiClient<any>(`/seller/catalog/product/${productId}/pause-sales`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  resumeSales(token: string, productId: string): Promise<ApiResponse<any>> {
    return apiClient<any>(`/seller/catalog/product/${productId}/resume-sales`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  removeMapping(token: string, mappingId: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/seller/catalog/mapping/${mappingId}`, {
      method: 'DELETE',
    });
  },

  bulkUpdateStock(token: string, updates: { mappingId: string; stockQty: number }[]): Promise<ApiResponse<any>> {
    return apiClient<any>('/seller/catalog/mapping/bulk-stock', {
      method: 'PATCH',
      body: JSON.stringify({ updates }),
    });
  },

  // Service areas
  getServiceAreas(token: string, params: { page?: number; limit?: number }): Promise<ApiResponse<any>> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    return apiClient<any>(`/seller/service-areas?${qs}`, {
      method: 'GET',
    });
  },

  addServiceAreas(token: string, pincodes: string[]): Promise<ApiResponse<any>> {
    return apiClient<any>('/seller/service-areas', {
      method: 'POST',
      body: JSON.stringify({ pincodes }),
    });
  },

  removeServiceArea(token: string, pincode: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/seller/service-areas/${pincode}`, {
      method: 'DELETE',
    });
  },

  // Story 3.1 — flip the COD-eligible flag on a specific pincode. The
  // backend stores `cod_eligible BOOLEAN DEFAULT FALSE` (added in
  // migration `20260513140000_add_seller_service_area_cod_eligible`)
  // and only emits COD as an option at checkout when the pincode the
  // customer is shipping to has this flag set.
  setServiceAreaCodEligibility(
    token: string,
    pincode: string,
    codEligible: boolean,
  ): Promise<ApiResponse<any>> {
    return apiClient<any>(`/seller/service-areas/${pincode}/cod`, {
      method: 'PATCH',
      body: JSON.stringify({ codEligible }),
    });
  },
};
