import {apiClient, ApiResponse} from '../lib/api-client';

// Storefront-level configuration that the mobile app reads at app
// start: pricing thresholds, tax rate, membership price, SLA windows.
// All fields optional so the consumer hook can degrade to its own
// fallback values when the endpoint isn't deployed yet.
export interface StorefrontConfig {
  /** Order subtotal in rupees above which shipping is free. */
  freeShippingThreshold?: number;
  /** Flat shipping fee in rupees when below the threshold. */
  shippingFee?: number;
  /** GST percentage applied at the cart display layer. */
  gstRate?: number;
  /** Annual membership price in rupees (Sportsmart+ promo strip). */
  membershipPriceYearly?: number;
  /** First-reply SLA window for the support form ("4 working hours"). */
  supportSlaHours?: number;
  /** How many hours flash sales run, used by the home countdown. */
  flashSaleDurationHours?: number;
  /** ISO currency code, typically 'INR'. */
  currency?: string;
}

export const configService = {
  get(): Promise<ApiResponse<StorefrontConfig>> {
    return apiClient<StorefrontConfig>('/storefront/config', {method: 'GET'});
  },
};
