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
  ) {
    return this.discountsService.validateCouponForCheckout(code, subtotal, items);
  }

  async incrementUsedCount(id: string) {
    return this.discountsService.incrementUsedCount(id);
  }
}
