import { apiClient, ApiResponse } from '../lib/api-client';

// Loose result shapes — these endpoints return varied envelopes; the
// component code accesses `definitions`, `filters`, `metafields` keys.
type DefinitionsResult = { definitions: any[]; [key: string]: any };
type FiltersResult = { filters: any[]; [key: string]: any };
type MetafieldsResult = { metafields: any[]; [key: string]: any };

export const adminMetafieldsService = {
  // ─── Metafield Definitions ──────────────────────────────────────

  listDefinitions(params?: { categoryId?: string; ownerType?: string; namespace?: string }): Promise<ApiResponse<DefinitionsResult>> {
    const qs = new URLSearchParams();
    if (params?.categoryId) qs.set('categoryId', params.categoryId);
    if (params?.ownerType) qs.set('ownerType', params.ownerType);
    if (params?.namespace) qs.set('namespace', params.namespace);
    const q = qs.toString();
    return apiClient<DefinitionsResult>(`/admin/metafield-definitions${q ? '?' + q : ''}`);
  },

  getDefinition(id: string): Promise<ApiResponse<any>> {
    return apiClient<any>(`/admin/metafield-definitions/${id}`);
  },

  getDefinitionsForCategory(categoryId: string): Promise<ApiResponse<DefinitionsResult>> {
    return apiClient<DefinitionsResult>(`/admin/categories/${categoryId}/metafield-definitions`);
  },

  createDefinition(payload: any): Promise<ApiResponse<any>> {
    return apiClient<any>('/admin/metafield-definitions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateDefinition(id: string, payload: any): Promise<ApiResponse<any>> {
    return apiClient<any>(`/admin/metafield-definitions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  deleteDefinition(id: string): Promise<ApiResponse<any>> {
    return apiClient<any>(`/admin/metafield-definitions/${id}`, { method: 'DELETE' });
  },

  bulkAssignDefinitions(categoryId: string, definitions: any[]): Promise<ApiResponse<any>> {
    return apiClient<any>(`/admin/categories/${categoryId}/metafield-definitions/bulk`, {
      method: 'POST',
      body: JSON.stringify({ definitions }),
    });
  },

  // ─── Product Metafield Values ──────────────────────────────────

  getProductMetafields(productId: string): Promise<ApiResponse<MetafieldsResult>> {
    return apiClient<MetafieldsResult>(`/admin/products/${productId}/metafields`);
  },

  upsertProductMetafields(productId: string, metafields: Array<{ definitionId: string; value: any }>): Promise<ApiResponse<any>> {
    return apiClient<any>(`/admin/products/${productId}/metafields`, {
      method: 'PUT',
      body: JSON.stringify({ metafields }),
    });
  },

  /**
   * DELETE /admin/products/:productId/metafields/:metafieldId — remove a single
   * metafield value. The corresponding metafield-definition stays; only this
   * product's value for it is cleared.
   */
  deleteProductMetafield(
    productId: string,
    metafieldId: string,
  ): Promise<ApiResponse<void>> {
    return apiClient<void>(
      `/admin/products/${productId}/metafields/${metafieldId}`,
      { method: 'DELETE' },
    );
  },

  // ─── Storefront Filter Configuration ──────────────────────────

  listFilters(params?: { scopeType?: string; isActive?: string }): Promise<ApiResponse<FiltersResult>> {
    const qs = new URLSearchParams();
    if (params?.scopeType) qs.set('scopeType', params.scopeType);
    if (params?.isActive) qs.set('isActive', params.isActive);
    const q = qs.toString();
    return apiClient<FiltersResult>(`/admin/storefront-filters${q ? '?' + q : ''}`);
  },

  createFilter(payload: any): Promise<ApiResponse<any>> {
    return apiClient<any>('/admin/storefront-filters', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateFilter(id: string, payload: any): Promise<ApiResponse<any>> {
    return apiClient<any>(`/admin/storefront-filters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  deleteFilter(id: string): Promise<ApiResponse<any>> {
    return apiClient<any>(`/admin/storefront-filters/${id}`, { method: 'DELETE' });
  },

  reorderFilters(ids: string[]): Promise<ApiResponse<any>> {
    return apiClient<any>('/admin/storefront-filters/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ ids }),
    });
  },
};
