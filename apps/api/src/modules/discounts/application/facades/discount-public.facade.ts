import { Injectable } from '@nestjs/common';
import { DiscountsService } from '../services/discounts.service';

@Injectable()
export class DiscountPublicFacade {
  constructor(private readonly discountsService: DiscountsService) {}

  async getDiscount(id: string) {
    return this.discountsService.get(id);
  }

  async listDiscounts(filters: {
    page: number;
    limit: number;
    status?: string;
    search?: string;
  }) {
    return this.discountsService.list(filters);
  }

  async validateCouponForCheckout(
    code: string,
    subtotal: number,
    items: Array<{ productId: string; quantity: number; unitPrice: number }> = [],
    // Phase E (P1.3) — optional eligibility context. Pass through
    // verbatim to the service.
    eligibilityArgs?: {
      customerId?: string | null;
      paymentMethod?: 'COD' | 'ONLINE' | 'WALLET' | 'UPI' | string;
      address?: { city?: string | null; pincode?: string | null; state?: string | null };
    },
  ) {
    return this.discountsService.validateCouponForCheckout(
      code,
      subtotal,
      items,
      eligibilityArgs,
    );
  }

  async incrementUsedCount(id: string) {
    return this.discountsService.incrementUsedCount(id);
  }
}
