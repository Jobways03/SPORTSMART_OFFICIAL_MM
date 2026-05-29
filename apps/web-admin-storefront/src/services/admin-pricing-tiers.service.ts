import { apiClient, ApiResponse } from '@/lib/api-client';

/**
 * Phase 44 (2026-05-21) — extended tier shape. The backend now supports
 * fixedUnitPrice / maxQuantity / start-end scheduling alongside the
 * pre-existing discountPercent ladder. Exactly one of
 * discountPercent / fixedUnitPrice is non-null on every row.
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

// Mirrors backend AdminProductPricingTiersController. All endpoints
// are gated on the admin bearer + catalog.write (writes) /
// products.read (reads).
export const adminPricingTiersService = {
  list(productId: string): Promise<ApiResponse<PricingTier[]>> {
    return apiClient<PricingTier[]>(`/admin/products/${productId}/pricing-tiers`);
  },

  create(
    productId: string,
    body: PricingTierWriteInput,
  ): Promise<ApiResponse<PricingTier>> {
    return apiClient<PricingTier>(`/admin/products/${productId}/pricing-tiers`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  update(
    productId: string,
    tierId: string,
    body: Partial<PricingTierWriteInput>,
  ): Promise<ApiResponse<PricingTier>> {
    return apiClient<PricingTier>(
      `/admin/products/${productId}/pricing-tiers/${tierId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
    );
  },

  remove(
    productId: string,
    tierId: string,
  ): Promise<ApiResponse<{ deleted: true; id: string }>> {
    return apiClient(
      `/admin/products/${productId}/pricing-tiers/${tierId}`,
      { method: 'DELETE' },
    );
  },
};
