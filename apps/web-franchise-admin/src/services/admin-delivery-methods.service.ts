import { apiClient } from '@/lib/api-client';

export interface FranchiseDeliveryMethodSettings {
  id: string;
  businessName: string;
  warehouseAddress: string | null;
  warehousePincode: string | null;
  city: string | null;
  state: string | null;
  phoneNumber: string | null;
  selfDeliveryEnabled: boolean;
  selfDeliveryPincodes: string[] | null;
}

export interface UpdateDeliveryMethodsInput {
  selfDeliveryEnabled?: boolean;
  selfDeliveryPincodes?: string[] | null;
}

/**
 * Franchise-admin endpoints. Same backing service as the marketplace
 * admin's seller endpoints, but mounted under /admin/franchises so
 * the franchise-admin auth context applies.
 */
export const franchiseAdminDeliveryMethodsService = {
  get(franchiseId: string) {
    return apiClient<FranchiseDeliveryMethodSettings>(
      `/admin/franchises/${franchiseId}/delivery-methods`,
    );
  },
  update(franchiseId: string, body: UpdateDeliveryMethodsInput) {
    return apiClient<FranchiseDeliveryMethodSettings>(
      `/admin/franchises/${franchiseId}/delivery-methods`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
  },
};
