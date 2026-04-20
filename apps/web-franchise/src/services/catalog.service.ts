import { apiClient, ApiResponse } from '@/lib/api-client';

export interface AvailableProduct {
  id: string;
  title: string;
  slug: string;
  baseSku: string | null;
  basePrice: number | null;
  status: string;
  category?: { id: string; name: string };
  brand?: { id: string; name: string };
  images?: Array<{ url: string; isPrimary: boolean }>;
}

export interface CatalogMapping {
  id: string;
  franchiseId: string;
  productId: string;
  variantId: string | null;
  globalSku: string;
  franchiseSku: string | null;
  barcode: string | null;
  isListedForOnlineFulfillment: boolean;
  isActive: boolean;
  approvalStatus: string;
  createdAt: string;
  product?: {
    id: string;
    title: string;
    slug: string;
    baseSku: string | null;
    basePrice: number | null;
    images?: Array<{ url: string; isPrimary: boolean }>;
  };
  variant?: {
    id: string;
    title: string | null;
    sku: string | null;
  } | null;
}

export interface AddMappingPayload {
  productId: string;
  variantId?: string;
  franchiseSku?: string;
  barcode?: string;
  isListedForOnlineFulfillment?: boolean;
}

export interface UpdateMappingPayload {
  franchiseSku?: string;
  barcode?: string;
  isListedForOnlineFulfillment?: boolean;
}

export interface AvailableProductsResponse {
  products: AvailableProduct[];
  total: number;
  page: number;
  totalPages: number;
}

export interface CatalogMappingsResponse {
  mappings: CatalogMapping[];
  total: number;
  page: number;
  totalPages: number;
}

export const franchiseCatalogService = {
  browseProducts(
    params: {
      page?: number;
      limit?: number;
      search?: string;
      categoryId?: string;
      brandId?: string;
    } = {},
  ): Promise<ApiResponse<AvailableProductsResponse>> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.search) qs.set('search', params.search);
    if (params.categoryId) qs.set('categoryId', params.categoryId);
    if (params.brandId) qs.set('brandId', params.brandId);
    return apiClient<AvailableProductsResponse>(
      `/franchise/catalog/available-products?${qs.toString()}`,
    );
  },
  listMappings(
    params: {
      page?: number;
      limit?: number;
      search?: string;
      isActive?: boolean;
      approvalStatus?: string;
    } = {},
  ): Promise<ApiResponse<CatalogMappingsResponse>> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.search) qs.set('search', params.search);
    if (params.isActive !== undefined) qs.set('isActive', String(params.isActive));
    if (params.approvalStatus) qs.set('approvalStatus', params.approvalStatus);
    return apiClient<CatalogMappingsResponse>(
      `/franchise/catalog/mappings?${qs.toString()}`,
    );
  },
  getMapping(mappingId: string): Promise<ApiResponse<CatalogMapping>> {
    return apiClient<CatalogMapping>(`/franchise/catalog/mappings/${mappingId}`);
  },
  addMapping(payload: AddMappingPayload): Promise<ApiResponse<CatalogMapping>> {
    return apiClient<CatalogMapping>('/franchise/catalog/mappings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  bulkAddMappings(mappings: AddMappingPayload[]): Promise<ApiResponse<unknown>> {
    return apiClient('/franchise/catalog/mappings/bulk', {
      method: 'POST',
      body: JSON.stringify({ mappings }),
    });
  },
  updateMapping(
    mappingId: string,
    data: UpdateMappingPayload,
  ): Promise<ApiResponse<unknown>> {
    return apiClient(`/franchise/catalog/mappings/${mappingId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
  removeMapping(mappingId: string): Promise<ApiResponse<unknown>> {
    return apiClient(`/franchise/catalog/mappings/${mappingId}`, {
      method: 'DELETE',
    });
  },
};
