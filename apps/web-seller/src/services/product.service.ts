import { apiClient, ApiError, ApiResponse } from '@/lib/api-client';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

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
  moderationNote: string | null;
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
  shortDescription: string | null;
  description: string | null;
  categoryId: string | null;
  brandId: string | null;
  status: string;
  moderationStatus: string;
  moderationNote: string | null;
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
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  getProduct(token: string, productId: string): Promise<ApiResponse<ProductDetail>> {
    return apiClient<ProductDetail>(`/seller/products/${productId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  createProduct(token: string, payload: CreateProductPayload): Promise<ApiResponse<ProductDetail>> {
    return apiClient<ProductDetail>('/seller/products', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  },

  updateProduct(token: string, productId: string, payload: UpdateProductPayload): Promise<ApiResponse<ProductDetail>> {
    return apiClient<ProductDetail>(`/seller/products/${productId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  },

  deleteProduct(token: string, productId: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/seller/products/${productId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  submitForReview(token: string, productId: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/seller/products/${productId}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
  },

  generateVariants(token: string, productId: string, optionValueIds: string[][]): Promise<ApiResponse<any>> {
    return apiClient<any>(`/seller/products/${productId}/variants/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ optionValueIds }),
    });
  },

  generateManualVariants(token: string, productId: string, options: { name: string; values: string[] }[]): Promise<ApiResponse<any>> {
    return apiClient<any>(`/seller/products/${productId}/variants/generate-manual`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ options }),
    });
  },

  updateVariant(token: string, productId: string, variantId: string, payload: any): Promise<ApiResponse<any>> {
    return apiClient<any>(`/seller/products/${productId}/variants/${variantId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  },

  bulkUpdateVariants(token: string, productId: string, variants: any[]): Promise<ApiResponse<any>> {
    return apiClient<any>(`/seller/products/${productId}/variants/bulk`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ variants }),
    });
  },

  createVariant(token: string, productId: string, payload: any): Promise<ApiResponse<any>> {
    return apiClient<any>(`/seller/products/${productId}/variants`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  },

  deleteVariant(token: string, productId: string, variantId: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/seller/products/${productId}/variants/${variantId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  async uploadImage(token: string, productId: string, file: File): Promise<ApiResponse<any>> {
    const formData = new FormData();
    formData.append('image', file);

    const url = `${API_BASE_URL}/api/v1/seller/products/${productId}/images`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    const body: ApiResponse<any> = await response.json();
    if (!response.ok) {
      throw new ApiError(response.status, body);
    }
    return body;
  },

  deleteImage(token: string, productId: string, imageId: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/seller/products/${productId}/images/${imageId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  reorderImages(token: string, productId: string, imageIds: string[]): Promise<ApiResponse<void>> {
    return apiClient<void>(`/seller/products/${productId}/images/reorder`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
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

  async uploadVariantImage(token: string, productId: string, variantId: string, file: File): Promise<ApiResponse<any>> {
    const formData = new FormData();
    formData.append('image', file);

    const url = `${API_BASE_URL}/api/v1/seller/products/${productId}/variants/${variantId}/images`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    const body: ApiResponse<any> = await response.json();
    if (!response.ok) {
      throw new ApiError(response.status, body);
    }
    return body;
  },

  deleteVariantImage(token: string, productId: string, variantId: string, imageId: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/seller/products/${productId}/variants/${variantId}/images/${imageId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  getOptions(): Promise<ApiResponse<any>> {
    return apiClient<any>('/catalog/options', {
      method: 'GET',
    });
  },
};
