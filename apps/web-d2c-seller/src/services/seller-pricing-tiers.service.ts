import { apiClient, ApiResponse } from '@/lib/api-client';

/**
 * Phase 44 (2026-05-21) — seller-facing pricing tier CRUD. Mirrors
 * the admin shape (same backend service); the seller endpoint
 * verifies product ownership via ProductOwnershipService.
 */
export interface PricingTier {
  id: string;
  productId: string;
  variantId: string | null;
  minQuantity: number;
  maxQuantity: number | null;
  discountPercent: number | null;
  fixedUnitPrice: number | null;
  displayLabel: string;
  startAt: string | null;
  endAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PricingTierWriteInput {
  variantId?: string | null;
  minQuantity: number;
  maxQuantity?: number | null;
  discountPercent?: number | null;
  fixedUnitPrice?: number | null;
  startAt?: string | null;
  endAt?: string | null;
  displayLabel?: string | null;
  isActive?: boolean;
}

export const sellerPricingTiersService = {
  list(productId: string): Promise<ApiResponse<PricingTier[]>> {
    return apiClient<PricingTier[]>(`/seller/products/${productId}/pricing-tiers`);
  },
  create(productId: string, body: PricingTierWriteInput): Promise<ApiResponse<PricingTier>> {
    return apiClient<PricingTier>(`/seller/products/${productId}/pricing-tiers`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  update(
    productId: string,
    tierId: string,
    body: Partial<PricingTierWriteInput>,
  ): Promise<ApiResponse<PricingTier>> {
    return apiClient<PricingTier>(`/seller/products/${productId}/pricing-tiers/${tierId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  remove(
    productId: string,
    tierId: string,
  ): Promise<ApiResponse<{ deleted: true; id: string }>> {
    return apiClient(`/seller/products/${productId}/pricing-tiers/${tierId}`, {
      method: 'DELETE',
    });
  },
};
