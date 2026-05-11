import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DeliveryMethod, SelfDeliveryStatus } from '@prisma/client';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Seller-facing delivery-method operations. Used from the
 * `web-seller` dashboard:
 *
 *   * `getMyEntitlements` — what methods can I use?
 *   * `chooseMethodForSubOrder` — pick iThink or self-delivery at
 *     accept time, validating against entitlement.
 *   * `transitionSelfDeliveryStatus` — manual progress for
 *     self-delivery shipments (no courier scans to drive this).
 *
 * Booking the iThink shipment (Add Order call) happens in the orders
 * module's accept-sub-order use case, not here. This service only
 * owns the choice + the self-delivery state machine.
 */
@Injectable()
export class SellerDeliveryMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyEntitlements(sellerId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: {
        id: true,
        ithinkEnabled: true,
        ithinkPickupAddressId: true,
        ithinkWarehouseStatus: true,
        selfDeliveryEnabled: true,
        selfDeliveryPincodes: true,
      },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    return {
      ithinkEnabled:
        seller.ithinkEnabled && seller.ithinkWarehouseStatus === 'APPROVED',
      ithinkPending:
        seller.ithinkEnabled && seller.ithinkWarehouseStatus === 'PENDING',
      ithinkWarehouseStatus: seller.ithinkWarehouseStatus,
      selfDeliveryEnabled: seller.selfDeliveryEnabled,
      selfDeliveryPincodes: seller.selfDeliveryPincodes,
    };
  }

  /**
   * Pick a delivery method for a sub-order at accept time. Asserts
   * that:
   *   - the sub-order belongs to this seller
   *   - the sub-order isn't already booked / past the choice window
   *   - the chosen method is enabled for this seller
   *
   * Returns the updated sub-order. Does NOT call iThink — booking
   * is the orders module's responsibility, triggered by the SubOrder
   * acceptance flow.
   */
  async chooseMethodForSubOrder(input: {
    sellerId: string;
    subOrderId: string;
    method: DeliveryMethod;
  }) {
    const subOrder = await this.prisma.subOrder.findUnique({
      where: { id: input.subOrderId },
      select: {
        id: true,
        sellerId: true,
        deliveryMethod: true,
        fulfillmentStatus: true,
        acceptStatus: true,
        ithinkAwb: true,
      },
    });
    if (!subOrder) throw new NotFoundException('SubOrder not found');
    if (subOrder.sellerId !== input.sellerId) {
      throw new ForbiddenException('This sub-order is not yours');
    }
    if (subOrder.ithinkAwb || subOrder.deliveryMethod) {
      throw new BadRequestException(
        'Delivery method is already set for this sub-order',
      );
    }

    const entitlements = await this.getMyEntitlements(input.sellerId);
    if (input.method === 'ITHINK_LOGISTICS' && !entitlements.ithinkEnabled) {
      throw new ForbiddenException(
        entitlements.ithinkPending
          ? 'iThink warehouse approval is still pending'
          : 'iThink is not enabled for your account',
      );
    }
    if (input.method === 'SELF_DELIVERY' && !entitlements.selfDeliveryEnabled) {
      throw new ForbiddenException('Self-delivery is not enabled for your account');
    }

    return this.prisma.subOrder.update({
      where: { id: input.subOrderId },
      data: {
        deliveryMethod: input.method,
        ...(input.method === 'SELF_DELIVERY' ? { selfDeliveryStatus: 'PENDING' } : {}),
      },
      select: {
        id: true,
        deliveryMethod: true,
        selfDeliveryStatus: true,
      },
    });
  }

  /**
   * Self-delivery status transition machine. Only forward transitions
   * are allowed; cancellation from any pre-delivered state is also
   * allowed.
   */
  async transitionSelfDeliveryStatus(input: {
    sellerId: string;
    subOrderId: string;
    next: SelfDeliveryStatus;
    notes?: string;
  }) {
    const subOrder = await this.prisma.subOrder.findUnique({
      where: { id: input.subOrderId },
      select: {
        id: true,
        sellerId: true,
        deliveryMethod: true,
        selfDeliveryStatus: true,
      },
    });
    if (!subOrder) throw new NotFoundException('SubOrder not found');
    if (subOrder.sellerId !== input.sellerId) {
      throw new ForbiddenException('This sub-order is not yours');
    }
    if (subOrder.deliveryMethod !== 'SELF_DELIVERY') {
      throw new BadRequestException(
        'Sub-order is not on the self-delivery path',
      );
    }
    if (!isLegalSelfDeliveryTransition(subOrder.selfDeliveryStatus, input.next)) {
      throw new BadRequestException(
        `Cannot transition self-delivery from ${subOrder.selfDeliveryStatus} to ${input.next}`,
      );
    }

    const deliveredAt = input.next === 'DELIVERED' ? new Date() : undefined;
    const fulfillmentUpdate = mapSelfStatusToFulfillment(input.next);

    return this.prisma.subOrder.update({
      where: { id: input.subOrderId },
      data: {
        selfDeliveryStatus: input.next,
        ...(deliveredAt ? { selfDeliveredAt: deliveredAt, deliveredAt } : {}),
        ...(fulfillmentUpdate ? { fulfillmentStatus: fulfillmentUpdate } : {}),
        selfDeliveryNotes: input.notes ?? undefined,
      },
      select: {
        id: true,
        selfDeliveryStatus: true,
        selfDeliveredAt: true,
        fulfillmentStatus: true,
      },
    });
  }
}

/**
 * Allowed forward / cancel transitions for the self-delivery state
 * machine. Backward transitions are disallowed to keep audit logic
 * monotonic; mistakes go through admin intervention.
 */
function isLegalSelfDeliveryTransition(
  current: SelfDeliveryStatus | null,
  next: SelfDeliveryStatus,
): boolean {
  const order: SelfDeliveryStatus[] = [
    'PENDING',
    'READY_FOR_PICKUP',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
  ];
  if (next === 'CANCELLED' || next === 'FAILED') {
    // Cannot cancel/fail after delivery is complete.
    return current !== 'DELIVERED';
  }
  const currIdx = current ? order.indexOf(current) : 0;
  const nextIdx = order.indexOf(next);
  // Allow only forward moves (and starting from null = PENDING).
  return nextIdx > currIdx;
}

/**
 * Mirror self-delivery status into the SubOrder.fulfillmentStatus
 * column so order list/detail screens stay consistent across
 * delivery methods.
 */
function mapSelfStatusToFulfillment(next: SelfDeliveryStatus) {
  switch (next) {
    case 'READY_FOR_PICKUP':
      return 'PACKED' as const;
    case 'OUT_FOR_DELIVERY':
      return 'SHIPPED' as const;
    case 'DELIVERED':
      return 'DELIVERED' as const;
    case 'CANCELLED':
    case 'FAILED':
      return 'CANCELLED' as const;
    default:
      return undefined;
  }
}
