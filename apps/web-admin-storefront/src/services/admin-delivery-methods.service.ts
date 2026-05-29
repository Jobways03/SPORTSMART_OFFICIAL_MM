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
  /** Pass `null` to clear filter (serve everywhere). */
  selfDeliveryPincodes?: string[] | null;
}

/**
 * Admin (marketplace) endpoints — manage which delivery methods a
 * seller is entitled to use.
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
