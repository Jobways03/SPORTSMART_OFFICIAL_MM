import {apiClient, ApiResponse} from '../lib/api-client';

export interface ShippingOption {
  optionId: string;
  optionName: string;
  feeInPaise: number | string;
  estimatedDays?: number | null;
  description?: string | null;
}

export const shippingService = {
  /**
   * Get shipping options + fees for the current cart total. Server-side
   * recompute happens at place-order, so the values here are advisory —
   * but the optionId chosen and passed to place-order IS what gets locked
   * onto the order.
   */
  quote(
    netCartValueInPaise: number,
  ): Promise<ApiResponse<ShippingOption[]>> {
    return apiClient<ShippingOption[]>('/customer/shipping-options/quote', {
      method: 'POST',
      body: JSON.stringify({netCartValueInPaise}),
    });
  },
};

export function feeInRupees(option: ShippingOption): number {
  return Number(option.feeInPaise) / 100;
}
