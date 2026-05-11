import { apiClient } from '@/lib/api-client';

export type IThinkWarehouseApprovalStatus =
  | 'NOT_REGISTERED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'STALE';

export interface FranchiseDeliveryMethodSettings {
  id: string;
  businessName: string;
  warehouseAddress: string | null;
  warehousePincode: string | null;
  city: string | null;
  state: string | null;
  phoneNumber: string | null;
  ithinkEnabled: boolean;
  ithinkPickupAddressId: string | null;
  ithinkWarehouseStatus: IThinkWarehouseApprovalStatus;
  ithinkRegisteredAt: string | null;
  selfDeliveryEnabled: boolean;
  selfDeliveryPincodes: string[] | null;
}

export interface UpdateDeliveryMethodsInput {
  ithinkEnabled?: boolean;
  selfDeliveryEnabled?: boolean;
  selfDeliveryPincodes?: string[] | null;
}

/**
 * Franchise-admin endpoints. Same backing service as the marketplace
 * admin's seller endpoints, but mounted under /admin/franchises so
 * the franchise-admin auth context applies.
 */
export interface IThinkRegistrationResult {
  id: string;
  ithinkPickupAddressId: string | null;
  ithinkWarehouseStatus: IThinkWarehouseApprovalStatus;
  ithinkRegisteredAt: string | null;
}

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
  registerWithIThink(franchiseId: string) {
    return apiClient<IThinkRegistrationResult>(
      `/admin/franchises/${franchiseId}/delivery-methods/register-ithink`,
      { method: 'POST', body: '{}' },
    );
  },
  refreshWithIThink(franchiseId: string) {
    return apiClient<IThinkRegistrationResult>(
      `/admin/franchises/${franchiseId}/delivery-methods/refresh-ithink`,
      { method: 'POST', body: '{}' },
    );
  },
  reregisterWithIThink(franchiseId: string) {
    return apiClient<IThinkRegistrationResult & { previousIThinkPickupAddressId?: string | null }>(
      `/admin/franchises/${franchiseId}/delivery-methods/reregister-ithink`,
      { method: 'POST', body: '{}' },
    );
  },
};
