import { apiClient } from '@/lib/api-client';

export type DeliveryMethod = 'SELF_DELIVERY';

export type SelfDeliveryStatus =
  | 'PENDING'
  | 'READY_FOR_PICKUP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED';

export interface SellerDeliveryEntitlements {
  selfDeliveryEnabled: boolean;
  selfDeliveryPincodes: string[] | null;
}

/**
 * Seller-facing endpoints for picking a method per shipment and
 * driving the manual self-delivery status machine. Called from the
 * seller order detail / actions UI.
 */
export const sellerDeliveryMethodsService = {
  getEntitlements() {
    return apiClient<SellerDeliveryEntitlements>('/seller/delivery-methods');
  },
  chooseMethod(subOrderId: string, method: DeliveryMethod) {
    return apiClient<{
      id: string;
      deliveryMethod: DeliveryMethod;
      selfDeliveryStatus: SelfDeliveryStatus | null;
    }>(`/seller/sub-orders/${subOrderId}/delivery-method`, {
      method: 'POST',
      body: JSON.stringify({ method }),
    });
  },
  transitionSelfDelivery(
    subOrderId: string,
    next: SelfDeliveryStatus,
    notes?: string,
  ) {
    return apiClient<{
      id: string;
      selfDeliveryStatus: SelfDeliveryStatus;
      selfDeliveredAt: string | null;
      fulfillmentStatus: string;
    }>(`/seller/sub-orders/${subOrderId}/self-delivery/status`, {
      method: 'POST',
      body: JSON.stringify({ next, notes }),
    });
  },
};
