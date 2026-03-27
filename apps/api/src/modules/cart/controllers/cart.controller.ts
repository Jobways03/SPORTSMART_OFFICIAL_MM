import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { UserAuthGuard } from '../../../core/guards';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../core/exceptions';

@ApiTags('Cart')
@Controller('customer/cart')
@UseGuards(UserAuthGuard)
export class CartController {
  constructor(private readonly prisma: PrismaService) {}

  // ── Helper: aggregated available stock from approved seller mappings ──────────
  private async getAggregatedStock(
    productId: string,
    variantId?: string | null,
  ): Promise<number> {
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

  @Get()
  async getCart(@Req() req: any) {
    const cart = await this.prisma.cart.findUnique({
      where: { customerId: req.userId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                slug: true,
                basePrice: true,
                platformPrice: true,
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
                platformPrice: true,
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

    if (!cart) {
      return {
        success: true,
        message: 'Cart is empty',
        data: { items: [], totalAmount: 0, itemCount: 0 },
      };
    }

    let totalAmount = 0;
    const items = await Promise.all(
      cart.items.map(async (item) => {
        // T2: Use platformPrice (fall back to basePrice/variant price)
        const price = item.variant
          ? Number(item.variant.platformPrice ?? item.variant.price)
          : Number(item.product.platformPrice ?? item.product.basePrice ?? 0);
        const lineTotal = price * item.quantity;
        totalAmount += lineTotal;

        const imageUrl =
          item.variant?.images?.[0]?.url ||
          item.product.images?.[0]?.url ||
          null;

        // T2: Calculate available stock from seller mappings (not product.baseStock)
        const availableStock = await this.getAggregatedStock(
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
      success: true,
      message: 'Cart retrieved',
      data: {
        items,
        totalAmount: Math.round(totalAmount * 100) / 100,
        itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
      },
    };
  }

  @Post('items')
  async addItem(
    @Req() req: any,
    @Body() body: { productId: string; variantId?: string; quantity?: number },
  ) {
    const { productId, variantId, quantity = 1 } = body;

    if (!productId) {
      throw new BadRequestAppException('productId is required');
    }
    if (quantity < 1) {
      throw new BadRequestAppException('Quantity must be at least 1');
    }

    // Validate product
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: 'ACTIVE', isDeleted: false },
    });
    if (!product) {
      throw new NotFoundAppException('Product not found or not available');
    }

    // Validate variant exists if specified
    if (variantId) {
      const variant = await this.prisma.productVariant.findFirst({
        where: { id: variantId, productId, isDeleted: false },
      });
      if (!variant) {
        throw new NotFoundAppException('Variant not found or not available');
      }
    }

    // T1: Check aggregated stock from seller mappings instead of product.baseStock
    const availableStock = await this.getAggregatedStock(productId, variantId);

    // Check existing cart item quantity + new quantity
    const existingCart = await this.prisma.cart.findUnique({
      where: { customerId: req.userId },
    });
    let existingQty = 0;
    if (existingCart) {
      const existingItem = await this.prisma.cartItem.findFirst({
        where: {
          cartId: existingCart.id,
          productId,
          variantId: variantId || null,
        },
      });
      if (existingItem) existingQty = existingItem.quantity;
    }

    if (availableStock < existingQty + quantity) {
      throw new BadRequestAppException(
        `Insufficient stock. Available: ${availableStock}, In cart: ${existingQty}, Requested: ${quantity}`,
      );
    }

    // Upsert cart
    const cart = await this.prisma.cart.upsert({
      where: { customerId: req.userId },
      create: { customerId: req.userId },
      update: {},
    });

    // Upsert cart item
    const existing = await this.prisma.cartItem.findFirst({
      where: {
        cartId: cart.id,
        productId,
        variantId: variantId || null,
      },
    });

    if (existing) {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + quantity },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId,
          variantId: variantId || null,
          quantity,
        },
      });
    }

    return { success: true, message: 'Item added to cart' };
  }

  @Patch('items/:itemId')
  async updateItem(
    @Req() req: any,
    @Param('itemId') itemId: string,
    @Body() body: { quantity: number },
  ) {
    const { quantity } = body;

    const cart = await this.prisma.cart.findUnique({
      where: { customerId: req.userId },
    });
    if (!cart) throw new NotFoundAppException('Cart not found');

    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
    });
    if (!item) throw new NotFoundAppException('Cart item not found');

    if (quantity <= 0) {
      await this.prisma.cartItem.delete({ where: { id: itemId } });
      return { success: true, message: 'Item removed from cart' };
    }

    // T1: Validate against aggregated stock
    const availableStock = await this.getAggregatedStock(
      item.productId,
      item.variantId,
    );
    if (availableStock < quantity) {
      throw new BadRequestAppException(
        `Insufficient stock. Available: ${availableStock}, Requested: ${quantity}`,
      );
    }

    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity },
    });

    return { success: true, message: 'Cart item updated' };
  }

  @Delete('items/:itemId')
  async removeItem(@Req() req: any, @Param('itemId') itemId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { customerId: req.userId },
    });
    if (!cart) throw new NotFoundAppException('Cart not found');

    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
    });
    if (!item) throw new NotFoundAppException('Cart item not found');

    await this.prisma.cartItem.delete({ where: { id: itemId } });

    return { success: true, message: 'Item removed from cart' };
  }

  @Delete()
  async clearCart(@Req() req: any) {
    const cart = await this.prisma.cart.findUnique({
      where: { customerId: req.userId },
    });

    if (cart) {
      await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    }

    return { success: true, message: 'Cart cleared' };
  }
}
