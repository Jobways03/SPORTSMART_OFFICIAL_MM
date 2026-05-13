import { Inject, Injectable } from '@nestjs/common';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import {
  CartRepository,
  CART_REPOSITORY,
} from '../../domain/repositories/cart.repository.interface';

@Injectable()
export class CartService {
  constructor(
    @Inject(CART_REPOSITORY) private readonly cartRepo: CartRepository,
  ) {}

  async getCart(customerId: string) {
    const cart = await this.cartRepo.findByCustomerId(customerId);

    if (!cart) {
      return { items: [], totalAmount: 0, itemCount: 0 };
    }

    let totalAmount = 0;
    const items = await Promise.all(
      cart.items.map(async (item) => {
        const price = item.variant
          ? Number(item.variant.price)
          : Number(item.product.basePrice ?? 0);
        const lineTotal = price * item.quantity;
        totalAmount += lineTotal;

        const imageUrl =
          item.variant?.images?.[0]?.url ||
          item.product.images?.[0]?.url ||
          null;

        const availableStock = await this.cartRepo.getAggregatedStock(
          item.productId,
          item.variantId,
        );

        return {
          id: item.id,
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          productTitle: item.product.title,
          variantTitle: item.variant?.title || null,
          slug: item.product.slug,
          sku: item.variant?.sku || item.product.baseSku,
          imageUrl,
          unitPrice: price,
          lineTotal,
          stock: availableStock,
          outOfStock: availableStock === 0,
        };
      }),
    );

    return {
      items,
      totalAmount: Math.round(totalAmount * 100) / 100,
      itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
    };
  }

  async addItem(
    customerId: string,
    productId: string,
    variantId: string | undefined,
    quantity: number,
  ) {
    if (!productId) {
      throw new BadRequestAppException('productId is required');
    }
    if (quantity < 1) {
      throw new BadRequestAppException('Quantity must be at least 1');
    }

    const productExists = await this.cartRepo.validateProduct(productId);
    if (!productExists) {
      throw new NotFoundAppException('Product not found or not available');
    }

    if (variantId) {
      const variantExists = await this.cartRepo.validateVariant(variantId, productId);
      if (!variantExists) {
        throw new NotFoundAppException('Variant not found or not available');
      }
    }

    const availableStock = await this.cartRepo.getAggregatedStock(productId, variantId);

    const existingCart = await this.cartRepo.findCartByCustomerId(customerId);
    let existingQty = 0;
    if (existingCart) {
      const existingItem = await this.cartRepo.findCartItem(
        existingCart.id,
        productId,
        variantId || null,
      );
      if (existingItem) existingQty = existingItem.quantity;
    }

    if (availableStock < existingQty + quantity) {
      throw new BadRequestAppException(
        `Insufficient stock. Available: ${availableStock}, In cart: ${existingQty}, Requested: ${quantity}`,
      );
    }

    const cart = await this.cartRepo.upsertCart(customerId);

    // Phase 1 (PR 1.9) — atomic find-or-increment-or-create. Replaces
    // the pre-PR `findCartItem` → `addCartItem|updateCartItemQuantity`
    // pair, which had a read-then-write TOCTOU window: two concurrent
    // requests for the same (cartId, productId, variantId) both saw no
    // existing row and both created a new one. The repo now holds a
    // row lock on the cart for the whole find+write so the second
    // request increments the first's row instead.
    await this.cartRepo.incrementOrCreateCartItem(
      cart.id,
      productId,
      variantId ?? null,
      quantity,
    );
  }

  async updateItem(customerId: string, itemId: string, quantity: number) {
    const cart = await this.cartRepo.findCartByCustomerId(customerId);
    if (!cart) throw new NotFoundAppException('Cart not found');

    const item = await this.cartRepo.findCartItemById(itemId, cart.id);
    if (!item) throw new NotFoundAppException('Cart item not found');

    if (quantity <= 0) {
      await this.cartRepo.deleteCartItem(itemId);
      return { removed: true };
    }

    const availableStock = await this.cartRepo.getAggregatedStock(
      item.productId,
      item.variantId,
    );
    if (availableStock < quantity) {
      throw new BadRequestAppException(
        `Insufficient stock. Available: ${availableStock}, Requested: ${quantity}`,
      );
    }

    await this.cartRepo.updateCartItemQuantity(itemId, quantity);
    return { removed: false };
  }

  async removeItem(customerId: string, itemId: string) {
    const cart = await this.cartRepo.findCartByCustomerId(customerId);
    if (!cart) throw new NotFoundAppException('Cart not found');

    const item = await this.cartRepo.findCartItemById(itemId, cart.id);
    if (!item) throw new NotFoundAppException('Cart item not found');

    await this.cartRepo.deleteCartItem(itemId);
  }

  async clearCart(customerId: string) {
    const cart = await this.cartRepo.findCartByCustomerId(customerId);
    if (cart) {
      await this.cartRepo.clearCart(cart.id);
    }
  }

  async countActiveItemsForVariant(variantId: string): Promise<number> {
    return this.cartRepo.countActiveItemsForVariant(variantId);
  }

  async countActiveItemsForProduct(productId: string): Promise<number> {
    return this.cartRepo.countActiveItemsForProduct(productId);
  }

  /**
   * Merge an anonymous-cart payload (held client-side in a cookie) into
   * the authenticated user's cart after login. Items are added one-by-one
   * via the existing addItem path so all validation + variant checks
   * still run. Failures on individual items are logged + skipped — a
   * single bad item shouldn't drop the whole merge.
   */
  async mergeAnonymousCart(
    customerId: string,
    items: Array<{ productId: string; variantId?: string; quantity: number }>,
  ): Promise<{ merged: number; skipped: number }> {
    let merged = 0;
    let skipped = 0;
    for (const it of items) {
      try {
        await this.addItem(customerId, it.productId, it.variantId, it.quantity);
        merged++;
      } catch {
        skipped++;
      }
    }
    return { merged, skipped };
  }
}
