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
