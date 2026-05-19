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

export interface UpdateDeliveryMethodsInput {
  ithinkEnabled?: boolean;
  selfDeliveryEnabled?: boolean;
  selfDeliveryPincodes?: string[] | null;
}

/**
 * Seller-admin (port 4001) endpoints for managing per-seller delivery
 * entitlements. Backed by the same /admin/sellers/:id/delivery-methods
 * endpoints as the storefront admin — both apps speak to the same API.
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
  /**
   * Calls iThink Add Warehouse on the seller's stored profile address.
   * Decoupled from the iThinkEnabled toggle so this can be retried
   * when iThink is unreachable or rejects creds, without rolling back
   * the entitlement flag.
   */
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
  /**
   * Re-register the pickup at the seller's current profile address.
   * Used when status is STALE because the seller updated their
   * address after the initial registration.
   */
  reregisterSellerWithIThink(sellerId: string) {
    return apiClient<IThinkRegistrationResult & { previousIThinkPickupAddressId?: string | null }>(
      `/admin/sellers/${sellerId}/delivery-methods/reregister-ithink`,
      { method: 'POST', body: '{}' },
    );
  },
};
