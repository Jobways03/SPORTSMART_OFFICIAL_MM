import { apiClient } from '@/lib/api-client';

export type IThinkWarehouseApprovalStatus =
  | 'NOT_REGISTERED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'STALE';

export interface SellerDeliveryMethodSettings {
  id: string;
  sellerName: string;
  sellerShopName: string;
  storeAddress: string | null;
  city: string | null;
  state: string | null;
  sellerZipCode: string | null;
  sellerContactNumber: string | null;
  ithinkEnabled: boolean;
  ithinkPickupAddressId: string | null;
  ithinkWarehouseStatus: IThinkWarehouseApprovalStatus;
  ithinkRegisteredAt: string | null;
  selfDeliveryEnabled: boolean;
  selfDeliveryPincodes: string[] | null;
}

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
  /** Pass `null` to clear filter (serve everywhere). */
  selfDeliveryPincodes?: string[] | null;
}

/**
 * Admin (marketplace) endpoints — manage which delivery methods a
 * seller or franchise is entitled to use. Flipping `ithinkEnabled`
 * from false → true on a seller / franchise that has never registered
 * with iThink triggers a server-side Add Warehouse call; the response
 * carries the resulting `ithinkWarehouseStatus = PENDING`.
 */
export interface IThinkRegistrationResult {
  id: string;
  ithinkPickupAddressId: string | null;
  ithinkWarehouseStatus: IThinkWarehouseApprovalStatus;
  ithinkRegisteredAt: string | null;
}

export const adminDeliveryMethodsService = {
  getSellerSettings(sellerId: string) {
    return apiClient<SellerDeliveryMethodSettings>(
      `/admin/sellers/${sellerId}/delivery-methods`,
    );
  },
  updateSellerSettings(sellerId: string, body: UpdateDeliveryMethodsInput) {
    return apiClient<SellerDeliveryMethodSettings>(
      `/admin/sellers/${sellerId}/delivery-methods`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
  },
  registerSellerWithIThink(sellerId: string) {
    return apiClient<IThinkRegistrationResult>(
      `/admin/sellers/${sellerId}/delivery-methods/register-ithink`,
      { method: 'POST', body: '{}' },
    );
  },
  refreshSellerIThinkStatus(sellerId: string) {
    return apiClient<IThinkRegistrationResult>(
      `/admin/sellers/${sellerId}/delivery-methods/refresh-ithink`,
      { method: 'POST', body: '{}' },
    );
  },
  reregisterSellerWithIThink(sellerId: string) {
    return apiClient<IThinkRegistrationResult & { previousIThinkPickupAddressId?: string | null }>(
      `/admin/sellers/${sellerId}/delivery-methods/reregister-ithink`,
      { method: 'POST', body: '{}' },
    );
  },
  getFranchiseSettings(franchiseId: string) {
    return apiClient<FranchiseDeliveryMethodSettings>(
      `/admin/franchises/${franchiseId}/delivery-methods`,
    );
  },
  updateFranchiseSettings(franchiseId: string, body: UpdateDeliveryMethodsInput) {
    return apiClient<FranchiseDeliveryMethodSettings>(
      `/admin/franchises/${franchiseId}/delivery-methods`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
  },
  registerFranchiseWithIThink(franchiseId: string) {
    return apiClient<IThinkRegistrationResult>(
      `/admin/franchises/${franchiseId}/delivery-methods/register-ithink`,
      { method: 'POST', body: '{}' },
    );
  },
  refreshFranchiseIThinkStatus(franchiseId: string) {
    return apiClient<IThinkRegistrationResult>(
      `/admin/franchises/${franchiseId}/delivery-methods/refresh-ithink`,
      { method: 'POST', body: '{}' },
    );
  },
  reregisterFranchiseWithIThink(franchiseId: string) {
    return apiClient<IThinkRegistrationResult & { previousIThinkPickupAddressId?: string | null }>(
      `/admin/franchises/${franchiseId}/delivery-methods/reregister-ithink`,
      { method: 'POST', body: '{}' },
    );
  },
};
