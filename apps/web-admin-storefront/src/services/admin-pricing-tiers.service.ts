import { apiClient, ApiResponse } from '@/lib/api-client';

export interface PricingTier {
  id: string;
  productId: string;
  variantId: string | null;
  minQuantity: number;
  discountPercent: number;
  displayLabel: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PricingTierWriteInput {
  variantId?: string | null;
  minQuantity: number;
  discountPercent: number;
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
