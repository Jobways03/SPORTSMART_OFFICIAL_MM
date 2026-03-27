import {
  Controller,
  Post,
  Patch,
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

@ApiTags('Customer Orders')
@Controller('customer/orders')
@UseGuards(UserAuthGuard)
export class CustomerOrdersController {
  constructor(private readonly prisma: PrismaService) {}

  // Legacy place-order endpoint (POST /customer/orders)
  // The primary place-order flow is via POST /customer/checkout/place-order
  @Post()
  async placeOrder(@Req() req: any, @Body() body: { addressId: string }) {
    const { addressId } = body;

    if (!addressId) {
      throw new BadRequestAppException('addressId is required');
    }

    // Validate address
    const address = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId: req.userId },
    });
    if (!address) {
      throw new NotFoundAppException('Address not found');
    }

    // Get cart with items
    const cart = await this.prisma.cart.findUnique({
      where: { customerId: req.userId },
      include: {
        items: {
          include: {
            product: {
              include: {
                seller: { select: { id: true, sellerShopName: true } },
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
                images: { select: { url: true }, take: 1 },
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new BadRequestAppException('Cart is empty');
    }

    // Run everything in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Validate stock for all items
      for (const item of cart.items) {
        if (item.variant) {
          const variant = await tx.productVariant.findUnique({
            where: { id: item.variant.id },
          });
          if (!variant || variant.stock < item.quantity) {
            throw new BadRequestAppException(
              `Insufficient stock for "${item.product.title}" (${item.variant.title || 'variant'})`,
            );
          }
        } else {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
          });
          if (!product || (product.baseStock ?? 0) < item.quantity) {
            throw new BadRequestAppException(
              `Insufficient stock for "${item.product.title}"`,
            );
          }
        }
      }

      // Generate order number atomically
      const seq = await tx.orderSequence.update({
        where: { id: 1 },
        data: { lastNumber: { increment: 1 } },
      });
      const year = new Date().getFullYear();
      const orderNumber = `SM${year}${String(seq.lastNumber).padStart(4, '0')}`;

      // Address snapshot
      const addressSnapshot = {
        fullName: address.fullName,
        phone: address.phone,
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country,
      };

      // Group items by seller
      const sellerGroups: Record<
        string,
        Array<(typeof cart.items)[number]>
      > = {};
      for (const item of cart.items) {
        const sellerId = item.product.seller?.id || 'unknown';
        if (!sellerGroups[sellerId]) sellerGroups[sellerId] = [];
        sellerGroups[sellerId].push(item);
      }

      // Calculate total
      let totalAmount = 0;
      let itemCount = 0;
      for (const item of cart.items) {
        const price = item.variant
          ? Number(item.variant.price)
          : Number(item.product.basePrice || 0);
        totalAmount += price * item.quantity;
        itemCount += item.quantity;
      }

      // Create master order with status PLACED (awaits admin verification)
      const masterOrder = await tx.masterOrder.create({
        data: {
          orderNumber,
          customerId: req.userId,
          shippingAddressSnapshot: addressSnapshot,
          totalAmount,
          paymentMethod: 'COD',
          paymentStatus: 'PENDING',
          orderStatus: 'PLACED',
          itemCount,
        },
      });

      // Create sub-orders per seller
      for (const [sellerId, items] of Object.entries(sellerGroups)) {
        let subTotal = 0;
        const orderItemsData = items.map((item) => {
          const price = item.variant
            ? Number(item.variant.price)
            : Number(item.product.basePrice || 0);
          const lineTotal = price * item.quantity;
          subTotal += lineTotal;

          const imageUrl =
            item.variant?.images?.[0]?.url ||
            item.product.images?.[0]?.url ||
            null;

          return {
            productId: item.productId,
            variantId: item.variantId,
            productTitle: item.product.title,
            variantTitle: item.variant?.title || null,
            sku: item.variant?.sku || item.product.baseSku || null,
            masterSku: item.variant?.sku || item.product.baseSku || null,
            imageUrl,
            unitPrice: price,
            quantity: item.quantity,
            totalPrice: lineTotal,
          };
        });

        await tx.subOrder.create({
          data: {
            masterOrderId: masterOrder.id,
            sellerId,
            subTotal,
            paymentStatus: 'PENDING',
            fulfillmentStatus: 'UNFULFILLED',
            acceptStatus: 'OPEN',
            items: {
              create: orderItemsData,
            },
          },
          include: { items: true },
        });
      }

      // Decrement stock
      for (const item of cart.items) {
        if (item.variant) {
          await tx.productVariant.update({
            where: { id: item.variant.id },
            data: { stock: { decrement: item.quantity } },
          });
        } else {
          await tx.product.update({
            where: { id: item.productId },
            data: { baseStock: { decrement: item.quantity } },
          });
        }
      }

      // Clear cart
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return { orderNumber, totalAmount, itemCount };
    });

    return {
      success: true,
      message: 'Order placed successfully',
      data: result,
    };
  }

  // PATCH /customer/orders/:orderNumber/cancel
  @Patch(':orderNumber/cancel')
  async cancelOrder(
    @Req() req: any,
    @Param('orderNumber') orderNumber: string,
  ) {
    const order = await this.prisma.masterOrder.findFirst({
      where: { orderNumber, customerId: req.userId },
      include: {
        subOrders: {
          include: { items: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundAppException('Order not found');
    }

    if (order.paymentStatus === 'CANCELLED') {
      throw new BadRequestAppException('Order is already cancelled');
    }

    // Cannot cancel if any sub-order is delivered and past return window
    const now = new Date();
    const hasExpiredReturnWindow = order.subOrders.some(
      (so) =>
        so.fulfillmentStatus === 'DELIVERED' &&
        so.returnWindowEndsAt &&
        new Date(so.returnWindowEndsAt) < now,
    );
    if (hasExpiredReturnWindow) {
      throw new BadRequestAppException(
        'Cannot cancel order — return/exchange window has expired',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Update master order
      await tx.masterOrder.update({
        where: { id: order.id },
        data: { paymentStatus: 'CANCELLED', orderStatus: 'CANCELLED' },
      });

      // Update all sub-orders
      for (const so of order.subOrders) {
        await tx.subOrder.update({
          where: { id: so.id },
          data: {
            paymentStatus: 'CANCELLED',
            acceptStatus: 'REJECTED',
            commissionProcessed: true,
          },
        });

        // Restore stock for each item
        for (const item of so.items) {
          if (item.variantId) {
            await tx.productVariant.update({
              where: { id: item.variantId },
              data: { stock: { increment: item.quantity } },
            });
          } else {
            await tx.product.update({
              where: { id: item.productId },
              data: { baseStock: { increment: item.quantity } },
            });
          }

          // Refund commission if already processed
          const commissionRecord = await tx.commissionRecord.findUnique({
            where: { orderItemId: item.id },
          });
          if (commissionRecord) {
            await tx.commissionRecord.update({
              where: { id: commissionRecord.id },
              data: {
                refundedAdminEarning: commissionRecord.adminEarning,
              },
            });
          }
        }
      }
    });

    return {
      success: true,
      message: 'Order cancelled successfully',
    };
  }
}
