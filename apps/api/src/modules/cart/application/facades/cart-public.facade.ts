import { Injectable } from '@nestjs/common';
import { CartService } from '../services/cart.service';
import type { CartItemForTaxPreview } from '../../domain/repositories/cart.repository.interface';

@Injectable()
export class CartPublicFacade {
  constructor(private readonly cartService: CartService) {}

  async getCart(customerId: string) {
    return this.cartService.getCart(customerId);
  }

  async clearCart(customerId: string) {
    return this.cartService.clearCart(customerId);
  }

  /**
   * Count cart items currently referencing a given variant. Used by the
   * catalog admin module to block soft-deletion of variants that are still
   * in someone's cart.
   */
  async countActiveItemsForVariant(variantId: string): Promise<number> {
    return this.cartService.countActiveItemsForVariant(variantId);
  }

  /**
   * Count cart items referencing a base product (variantId IS NULL). Used
   * by the catalog admin module before soft-deleting a non-variant product.
   */
  async countActiveItemsForProduct(productId: string): Promise<number> {
    return this.cartService.countActiveItemsForProduct(productId);
  }

  /**
   * Phase 37 — minimal active-cart projection for the tax module's
   * cart-side preview. Excludes save-for-later items. The tax module
   * never reads the cart table directly.
   */
  async getItemsForTaxPreview(
    customerId: string,
  ): Promise<CartItemForTaxPreview[]> {
    return this.cartService.getItemsForTaxPreview(customerId);
  }
}
