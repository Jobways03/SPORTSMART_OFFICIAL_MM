import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { CartRepository, CartWithItems } from '../../domain/repositories/cart.repository.interface';

@Injectable()
export class PrismaCartRepository implements CartRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByCustomerId(customerId: string): Promise<CartWithItems | null> {
    return this.prisma.cart.findUnique({
      where: { customerId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                slug: true,
                basePrice: true,
                baseStock: true,
                baseSku: true,
                hasVariants: true,
                status: true,
                images: {
                  where: { isPrimary: true },
                  select: { url: true },
                  take: 1,
                },
              },
            },
            variant: {
              select: {
                id: true,
                title: true,
                price: true,
                stock: true,
                sku: true,
                status: true,
                images: {
                  select: { url: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
  }

  async upsertCart(customerId: string): Promise<{ id: string }> {
    return this.prisma.cart.upsert({
      where: { customerId },
      create: { customerId },
      update: {},
    });
  }

  async findCartItem(
    cartId: string,
    productId: string,
    variantId: string | null,
  ): Promise<{ id: string; quantity: number } | null> {
    return this.prisma.cartItem.findFirst({
      where: { cartId, productId, variantId },
    });
  }

  async addCartItem(
    cartId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
  ): Promise<void> {
    await this.prisma.cartItem.create({
      data: { cartId, productId, variantId, quantity },
    });
  }

  async updateCartItemQuantity(itemId: string, quantity: number): Promise<void> {
    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity },
    });
  }

  async deleteCartItem(itemId: string): Promise<void> {
    await this.prisma.cartItem.delete({ where: { id: itemId } });
  }

  async clearCart(cartId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { cartId } });
  }

  async findCartByCustomerId(customerId: string): Promise<{ id: string } | null> {
    return this.prisma.cart.findUnique({ where: { customerId } });
  }

  async findCartItemById(
    itemId: string,
    cartId: string,
  ): Promise<{ id: string; productId: string; variantId: string | null; quantity: number } | null> {
    return this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId },
    });
  }

  async getAggregatedStock(productId: string, variantId?: string | null): Promise<number> {
    const where: any = { productId, isActive: true, approvalStatus: 'APPROVED' };
    if (variantId) where.variantId = variantId;

    const result = await this.prisma.sellerProductMapping.aggregate({
      where,
      _sum: { stockQty: true, reservedQty: true },
    });

    const totalStock = result._sum.stockQty ?? 0;
    const totalReserved = result._sum.reservedQty ?? 0;
    return Math.max(0, totalStock - totalReserved);
  }

  async validateProduct(productId: string): Promise<boolean> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: 'ACTIVE', isDeleted: false },
    });
    return !!product;
  }

  async validateVariant(variantId: string, productId: string): Promise<boolean> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, isDeleted: false },
    });
    return !!variant;
  }

  async countActiveItemsForVariant(variantId: string): Promise<number> {
    return this.prisma.cartItem.count({
      where: { variantId },
    });
  }

  async countActiveItemsForProduct(productId: string): Promise<number> {
    // Only count base-product line items (where variantId is null) — variant
    // line items are tracked separately by countActiveItemsForVariant.
    return this.prisma.cartItem.count({
      where: { productId, variantId: null },
    });
  }

  /**
   * Phase 1 (PR 1.9) — atomic find-or-increment-or-create.
   *
   * The transaction holds a `SELECT ... FOR UPDATE` lock on the cart
   * row. A second concurrent call for the same customerId waits on
   * that lock; when it gets the row, the first call's cart_items row
   * is already visible inside the second call's transaction, so the
   * second branch goes through `update` (quantity increment) instead
   * of `create` (duplicate row).
   *
   * Why lock the Cart row and not the CartItem row:
   *   - On the create branch, no CartItem row exists yet — there's
   *     nothing to lock.
   *   - Cart.customerId is `@unique`, so the cart row is the natural
   *     per-customer serialisation point.
   *   - The lock is held only across two short queries; contention is
   *     bounded to N requests per customer, not N requests cluster-
   *     wide.
   *
   * Why `$queryRaw` over `findUnique`: Prisma doesn't expose
   * `FOR UPDATE` on `findUnique`. The raw query is parameterised to
   * stay safe from injection (tagged-template binding).
   */
  async incrementOrCreateCartItem(
    cartId: string,
    productId: string,
    variantId: string | null,
    quantityDelta: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Row lock on the cart — serialises addItem for this customer.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM carts WHERE id = ${cartId} FOR UPDATE
      `;
      if (!locked || locked.length === 0) {
        throw new Error(`Cart ${cartId} not found while acquiring row lock`);
      }

      const existing = await tx.cartItem.findFirst({
        where: { cartId, productId, variantId },
      });

      if (existing) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + quantityDelta },
        });
      } else {
        await tx.cartItem.create({
          data: { cartId, productId, variantId, quantity: quantityDelta },
        });
      }
    });
  }
}
