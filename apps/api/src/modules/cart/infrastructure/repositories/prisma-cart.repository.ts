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
}
