import { Injectable, Inject } from '@nestjs/common';
import {
  CHECKOUT_REPOSITORY,
  ICheckoutRepository,
} from '../../domain/repositories/checkout.repository.interface';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

@Injectable()
export class CustomerOrdersService {
  constructor(
    @Inject(CHECKOUT_REPOSITORY)
    private readonly repo: ICheckoutRepository,
  ) {}

  // ── Legacy place-order ─────────────────────────────────────────────────

  async placeOrder(userId: string, addressId: string) {
    if (!addressId) {
      throw new BadRequestAppException('addressId is required');
    }

    // Validate address
    const address = await this.repo.findAddressByIdAndCustomer(addressId, userId);
    if (!address) {
      throw new NotFoundAppException('Address not found');
    }

    // Get cart with items
    const cart = await this.repo.findCartWithLegacyItems(userId);
    if (!cart || cart.items.length === 0) {
      throw new BadRequestAppException('Cart is empty');
    }

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

    const result = await this.repo.legacyPlaceOrderTransaction(
      userId,
      cart,
      addressSnapshot,
    );

    return result;
  }

  // ── Cancel order ───────────────────────────────────────────────────────

  async cancelOrder(userId: string, orderNumber: string) {
    const order = await this.repo.findMasterOrderWithSubOrders(orderNumber, userId);

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

    await this.repo.cancelOrderTransaction(order);

    return { success: true };
  }
}
