import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DeliveryMethod, SelfDeliveryStatus } from '@prisma/client';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Franchise-facing delivery-method operations. Mirrors
 * `SellerDeliveryMethodsService` exactly but operates on
 * `franchisePartner` and validates franchise ownership of the
 * sub-order via `subOrder.franchiseId` rather than `sellerId`.
 *
 * Kept as a separate class (instead of generic seller/franchise
 * shared service) because the auth context and ownership column
 * differ and forcing them through a shared abstraction obscures
 * which entity owns the check.
 */
@Injectable()
export class FranchiseDeliveryMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyEntitlements(franchiseId: string) {
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: {
        id: true,
        ithinkEnabled: true,
        ithinkPickupAddressId: true,
        ithinkWarehouseStatus: true,
        selfDeliveryEnabled: true,
        selfDeliveryPincodes: true,
      },
    });
    if (!franchise) throw new NotFoundException('Franchise not found');
    return {
      ithinkEnabled:
        franchise.ithinkEnabled && franchise.ithinkWarehouseStatus === 'APPROVED',
      ithinkPending:
        franchise.ithinkEnabled && franchise.ithinkWarehouseStatus === 'PENDING',
      ithinkWarehouseStatus: franchise.ithinkWarehouseStatus,
      selfDeliveryEnabled: franchise.selfDeliveryEnabled,
      selfDeliveryPincodes: franchise.selfDeliveryPincodes,
    };
  }

  async chooseMethodForSubOrder(input: {
    franchiseId: string;
    subOrderId: string;
    method: DeliveryMethod;
  }) {
    const subOrder = await this.prisma.subOrder.findUnique({
      where: { id: input.subOrderId },
      select: {
        id: true,
        franchiseId: true,
        deliveryMethod: true,
        ithinkAwb: true,
      },
    });
    if (!subOrder) throw new NotFoundException('SubOrder not found');
    if (subOrder.franchiseId !== input.franchiseId) {
      throw new ForbiddenException('This sub-order is not yours');
    }
    if (subOrder.ithinkAwb || subOrder.deliveryMethod) {
      throw new BadRequestException(
        'Delivery method is already set for this sub-order',
      );
    }

    const entitlements = await this.getMyEntitlements(input.franchiseId);
    if (input.method === 'ITHINK_LOGISTICS' && !entitlements.ithinkEnabled) {
      throw new ForbiddenException(
        entitlements.ithinkPending
          ? 'iThink warehouse approval is still pending'
          : 'iThink is not enabled for your franchise',
      );
    }
    if (input.method === 'SELF_DELIVERY' && !entitlements.selfDeliveryEnabled) {
      throw new ForbiddenException('Self-delivery is not enabled for your franchise');
    }

    return this.prisma.subOrder.update({
      where: { id: input.subOrderId },
      data: {
        deliveryMethod: input.method,
        ...(input.method === 'SELF_DELIVERY' ? { selfDeliveryStatus: 'PENDING' } : {}),
      },
      select: { id: true, deliveryMethod: true, selfDeliveryStatus: true },
    });
  }

  async transitionSelfDeliveryStatus(input: {
    franchiseId: string;
    subOrderId: string;
    next: SelfDeliveryStatus;
    notes?: string;
  }) {
    const subOrder = await this.prisma.subOrder.findUnique({
      where: { id: input.subOrderId },
      select: {
        id: true,
        franchiseId: true,
        deliveryMethod: true,
        selfDeliveryStatus: true,
      },
    });
    if (!subOrder) throw new NotFoundException('SubOrder not found');
    if (subOrder.franchiseId !== input.franchiseId) {
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
    return current !== 'DELIVERED';
  }
  const currIdx = current ? order.indexOf(current) : 0;
  const nextIdx = order.indexOf(next);
  return nextIdx > currIdx;
}

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
