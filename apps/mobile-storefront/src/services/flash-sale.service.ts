import {apiClient, ApiResponse} from '../lib/api-client';

// Time-boxed promotional campaign — drives the HomeScreen "Today's
// deals" countdown strip and the "Members only" upcoming-drop card.
// endsAt is ISO; the UI computes the live countdown locally.
export interface FlashSale {
  id: string;
  title: string;
  subtitle?: string;
  /** ISO date — used to compute the live countdown. */
  endsAt: string;
  /** Members-only campaigns get a different visual treatment. */
  membersOnly?: boolean;
  /** Where tapping the card should take the user (slug or url). */
  collectionSlug?: string;
  /** Waitlist size displayed under the CTA, when present. */
  waitlistCount?: number;
}

export const flashSaleService = {
  active(): Promise<ApiResponse<{sales: FlashSale[]}>> {
    return apiClient<{sales: FlashSale[]}>('/storefront/flash-sales');
  },
};
