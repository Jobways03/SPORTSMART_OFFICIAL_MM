import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  ICheckoutRepository,
  CustomerAddressEntity,
  CreateAddressInput,
  CartWithItems,
  MasterOrderEntity,
  PlaceOrderTransactionInput,
  PlaceOrderTransactionResult,
  LegacyPlaceOrderTransactionResult,
} from '../../domain/repositories/checkout.repository.interface';
import { BadRequestAppException } from '../../../../core/exceptions';

@Injectable()
export class PrismaCheckoutRepository implements ICheckoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Address operations ───────────────────────────────────────────────────

  async findAddressByIdAndCustomer(
    addressId: string,
    customerId: string,
  ): Promise<CustomerAddressEntity | null> {
    return this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
    });
  }

  async findAddressesByCustomer(customerId: string): Promise<CustomerAddressEntity[]> {
    return this.prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async clearDefaultAddresses(customerId: string): Promise<void> {
    await this.prisma.customerAddress.updateMany({
      where: { customerId, isDefault: true },
      data: { isDefault: false },
    });
  }

  async createAddress(input: CreateAddressInput): Promise<CustomerAddressEntity> {
    return this.prisma.customerAddress.create({
      data: {
        customerId: input.customerId,
        fullName: input.fullName,
        phone: input.phone,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 || null,
        locality: input.locality || null,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        isDefault: input.isDefault || false,
      },
    });
  }

  // ── Cart operations ──────────────────────────────────────────────────────

  async findCartWithCheckoutItems(customerId: string): Promise<CartWithItems | null> {
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
  }

  async findCartWithLegacyItems(customerId: string): Promise<CartWithItems | null> {
    const cart = await this.prisma.cart.findUnique({
      where: { customerId },
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
    // Cast at the Prisma boundary — the domain interface uses loose types (any)
    // for price fields, and the legacy query omits platformPrice/status on variant.
    return cart as CartWithItems | null;
  }

  async deleteCartItemsByIds(cartItemIds: string[]): Promise<void> {
    await this.prisma.cartItem.deleteMany({
      where: { id: { in: cartItemIds } },
    });
  }

  // ── Order operations ─────────────────────────────────────────────────────

  async placeOrderTransaction(
    input: PlaceOrderTransactionInput,
  ): Promise<PlaceOrderTransactionResult> {
    return this.prisma.$transaction(async (tx) => {
      // Generate order number (upsert ensures row always exists)
      const seq = await tx.orderSequence.upsert({
        where: { id: 1 },
        create: { id: 1, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      const year = new Date().getFullYear();
      const orderNumber = `SM${year}${String(seq.lastNumber).padStart(4, '0')}`;

      // Create master order with status PLACED (awaits admin verification)
      const masterOrder = await tx.masterOrder.create({
        data: {
          orderNumber,
          customerId: input.customerId,
          shippingAddressSnapshot: input.addressSnapshot,
          totalAmount: input.totalAmount,
          paymentMethod: 'COD',
          paymentStatus: 'PENDING',
          orderStatus: 'PLACED',
          itemCount: input.itemCount,
        },
      });

      // Create sub-orders per seller
      const createdSubOrders: PlaceOrderTransactionResult['createdSubOrders'] = [];
      for (const [sellerId, group] of Object.entries(input.sellerGroups)) {
        let subTotal = 0;
        const orderItemsData = group.items.map((item) => {
          subTotal += item.totalPrice;
          return {
            productId: item.productId,
            variantId: item.variantId,
            productTitle: item.productTitle,
            variantTitle: item.variantTitle,
            sku: item.sku,
            masterSku: item.masterSku,
            imageUrl: item.imageUrl,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            totalPrice: item.totalPrice,
          };
        });

        const subOrder = await tx.subOrder.create({
          data: {
            masterOrderId: masterOrder.id,
            sellerId,
            subTotal,
            paymentStatus: 'PENDING',
            fulfillmentStatus: 'UNFULFILLED',
            acceptStatus: 'OPEN',
            items: { create: orderItemsData },
          },
        });

        createdSubOrders.push({
          subOrderId: subOrder.id,
          sellerId,
          sellerName: group.sellerName,
          subTotal,
          itemCount: group.items.reduce((s, i) => s + i.quantity, 0),
        });
      }

      // Clear cart
      const cart = await tx.cart.findUnique({
        where: { customerId: input.customerId },
      });
      let cartCleared = false;
      if (cart) {
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        cartCleared = true;
      }

      return {
        orderNumber,
        masterOrderId: masterOrder.id,
        totalAmount: input.totalAmount,
        itemCount: input.itemCount,
        createdSubOrders,
        cartCleared,
      };
    });
  }

  async legacyPlaceOrderTransaction(
    customerId: string,
    cart: CartWithItems,
    addressSnapshot: Record<string, any>,
  ): Promise<LegacyPlaceOrderTransactionResult> {
    return this.prisma.$transaction(async (tx) => {
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

      // Group items by seller
      const sellerGroups: Record<string, Array<(typeof cart.items)[number]>> = {};
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
          customerId,
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
  }

  // ── Order queries ────────────────────────────────────────────────────────

  async findMasterOrderWithSubOrders(
    orderNumber: string,
    customerId: string,
  ): Promise<MasterOrderEntity | null> {
    const order = await this.prisma.masterOrder.findFirst({
      where: { orderNumber, customerId },
      include: {
        subOrders: {
          include: { items: true },
        },
      },
    });
    if (!order) return null;
    // Map Prisma Decimal fields to plain numbers at the boundary
    return {
      ...order,
      totalAmount: Number(order.totalAmount),
      subOrders: order.subOrders.map((so) => ({
        ...so,
        subTotal: Number(so.subTotal),
      })),
    } as MasterOrderEntity;
  }

  // ── Cancel operations ────────────────────────────────────────────────────

  async cancelOrderTransaction(order: MasterOrderEntity): Promise<void> {
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
  }
}
