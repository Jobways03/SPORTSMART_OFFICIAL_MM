import { apiClient } from '@/lib/api-client';

export interface SellerDeliveryMethodSettings {
  id: string;
  sellerName: string;
  sellerShopName: string;
  storeAddress: string | null;
  city: string | null;
  state: string | null;
  sellerZipCode: string | null;
  sellerContactNumber: string | null;
  selfDeliveryEnabled: boolean;
  selfDeliveryPincodes: string[] | null;
}

export interface UpdateDeliveryMethodsInput {
  selfDeliveryEnabled?: boolean;
  selfDeliveryPincodes?: string[] | null;
}

/**
 * Seller-admin (port 4001) endpoints for managing per-seller delivery
 * entitlements. Backed by the same /admin/sellers/:id/delivery-methods
 * endpoints as the storefront admin — both apps speak to the same API.
 */
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
};
