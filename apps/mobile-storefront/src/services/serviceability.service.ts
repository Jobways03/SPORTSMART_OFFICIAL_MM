import {apiClient, ApiResponse} from '../lib/api-client';

export interface ServiceabilityResult {
  serviceable: boolean;
  estimatedDays?: number;
  deliveryEstimate?: string;
  message?: string;
}

export const serviceabilityService = {
  check(
    productId: string,
    pincode: string,
    variantId?: string,
  ): Promise<ApiResponse<ServiceabilityResult>> {
    const params = new URLSearchParams({productId, pincode});
    if (variantId) params.set('variantId', variantId);
    return apiClient<ServiceabilityResult>(
      `/storefront/serviceability/check?${params.toString()}`,
    );
  },
};
