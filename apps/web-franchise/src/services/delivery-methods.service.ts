import { apiClient } from '@/lib/api-client';

export type DeliveryMethod = 'SELF_DELIVERY';

export type SelfDeliveryStatus =
  | 'PENDING'
  | 'READY_FOR_PICKUP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED';

export interface FranchiseDeliveryEntitlements {
  selfDeliveryEnabled: boolean;
  selfDeliveryPincodes: string[] | null;
}

/**
 * Franchise-facing endpoints. Identical contract to the seller-side
 * but routes under /franchise/* so the franchise auth context applies.
 */
export const franchiseDeliveryMethodsService = {
  getEntitlements() {
    return apiClient<FranchiseDeliveryEntitlements>('/franchise/delivery-methods');
  },
  chooseMethod(subOrderId: string, method: DeliveryMethod) {
    return apiClient<{
      id: string;
      deliveryMethod: DeliveryMethod;
      selfDeliveryStatus: SelfDeliveryStatus | null;
    }>(`/franchise/sub-orders/${subOrderId}/delivery-method`, {
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
    }>(`/franchise/sub-orders/${subOrderId}/self-delivery/status`, {
      method: 'POST',
      body: JSON.stringify({ next, notes }),
    });
  },
};
