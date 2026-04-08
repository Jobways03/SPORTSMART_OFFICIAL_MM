import { apiClient, ApiResponse } from '../lib/api-client';

export const adminMetafieldsService = {
  // ─── Metafield Definitions ──────────────────────────────────────

  listDefinitions(params?: { categoryId?: string; ownerType?: string; namespace?: string }): Promise<ApiResponse> {
    const qs = new URLSearchParams();
    if (params?.categoryId) qs.set('categoryId', params.categoryId);
    if (params?.ownerType) qs.set('ownerType', params.ownerType);
    if (params?.namespace) qs.set('namespace', params.namespace);
    const q = qs.toString();
    return apiClient(`/admin/metafield-definitions${q ? '?' + q : ''}`);
  },

  getDefinition(id: string): Promise<ApiResponse> {
    return apiClient(`/admin/metafield-definitions/${id}`);
  },

  getDefinitionsForCategory(categoryId: string): Promise<ApiResponse> {
    return apiClient(`/admin/categories/${categoryId}/metafield-definitions`);
  },

  createDefinition(payload: any): Promise<ApiResponse> {
    return apiClient('/admin/metafield-definitions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateDefinition(id: string, payload: any): Promise<ApiResponse> {
    return apiClient(`/admin/metafield-definitions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  deleteDefinition(id: string): Promise<ApiResponse> {
    return apiClient(`/admin/metafield-definitions/${id}`, { method: 'DELETE' });
  },

  bulkAssignDefinitions(categoryId: string, definitions: any[]): Promise<ApiResponse> {
    return apiClient(`/admin/categories/${categoryId}/metafield-definitions/bulk`, {
      method: 'POST',
      body: JSON.stringify({ definitions }),
    });
  },

  // ─── Product Metafield Values ──────────────────────────────────

  getProductMetafields(productId: string): Promise<ApiResponse> {
    return apiClient(`/admin/products/${productId}/metafields`);
  },

  upsertProductMetafields(productId: string, metafields: Array<{ definitionId: string; value: any }>): Promise<ApiResponse> {
    return apiClient(`/admin/products/${productId}/metafields`, {
      method: 'PUT',
      body: JSON.stringify({ metafields }),
    });
  },

  // ─── Storefront Filter Configuration ──────────────────────────

  listFilters(params?: { scopeType?: string; isActive?: string }): Promise<ApiResponse> {
    const qs = new URLSearchParams();
    if (params?.scopeType) qs.set('scopeType', params.scopeType);
    if (params?.isActive) qs.set('isActive', params.isActive);
    const q = qs.toString();
    return apiClient(`/admin/storefront-filters${q ? '?' + q : ''}`);
  },

  createFilter(payload: any): Promise<ApiResponse> {
    return apiClient('/admin/storefront-filters', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateFilter(id: string, payload: any): Promise<ApiResponse> {
    return apiClient(`/admin/storefront-filters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  deleteFilter(id: string): Promise<ApiResponse> {
    return apiClient(`/admin/storefront-filters/${id}`, { method: 'DELETE' });
  },

  reorderFilters(ids: string[]): Promise<ApiResponse> {
    return apiClient('/admin/storefront-filters/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ ids }),
    });
  },
};
