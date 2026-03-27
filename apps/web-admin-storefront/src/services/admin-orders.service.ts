import { apiClient, ApiResponse } from '@/lib/api-client';

export interface VerifyOrderResponse {
  id: string;
  orderNumber: string;
  orderStatus: string;
  verified: boolean;
  verifiedAt: string;
  verifiedBy: string | null;
  verificationRemarks: string | null;
}

export interface EligibleSeller {
  sellerId: string;
  sellerName: string;
  shopName: string;
  distanceKm: number;
  dispatchSla: number;
  availableStock: number;
  score: number;
}

export interface ReassignResponse {
  id: string;
  sellerId: string;
  acceptStatus: string;
  fulfillmentStatus: string;
  acceptDeadlineAt: string;
  items: any[];
  seller: { id: string; sellerName: string; sellerShopName: string; email: string };
}

/**
 * Verify an order and route it to the best eligible seller.
 * POST /admin/orders/:orderId/verify
 */
export async function verifyOrder(
  orderId: string,
  remarks?: string,
): Promise<ApiResponse<VerifyOrderResponse>> {
  return apiClient<VerifyOrderResponse>(`/admin/orders/${orderId}/verify`, {
    method: 'POST',
    body: JSON.stringify({ remarks }),
  });
}

/**
 * Get eligible sellers for reassignment of a sub-order.
 * GET /admin/orders/sub-orders/:subOrderId/eligible-sellers
 */
export async function getEligibleSellers(
  subOrderId: string,
): Promise<ApiResponse<EligibleSeller[]>> {
  return apiClient<EligibleSeller[]>(`/admin/orders/sub-orders/${subOrderId}/eligible-sellers`);
}

/**
 * Reassign a sub-order to a different seller.
 * POST /admin/orders/sub-orders/:subOrderId/reassign
 */
export async function reassignOrder(
  subOrderId: string,
  sellerId: string,
  reason?: string,
): Promise<ApiResponse<ReassignResponse>> {
  return apiClient<ReassignResponse>(`/admin/orders/sub-orders/${subOrderId}/reassign`, {
    method: 'POST',
    body: JSON.stringify({ sellerId, reason }),
  });
}
