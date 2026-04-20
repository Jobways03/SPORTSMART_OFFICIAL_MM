import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import {
  RETURN_REPOSITORY,
  ReturnRepository,
} from '../../domain/repositories/return.repository.interface';

export interface EligibleItem {
  orderItemId: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPrice: number;
  alreadyReturnedQty: number;
  availableForReturn: number;
  eligible: boolean;
}

export interface EligibleSubOrder {
  subOrderId: string;
  orderNumber: string;
  deliveredAt: Date | null;
  returnWindowEndsAt: Date | null;
  windowExpired: boolean;
  items: EligibleItem[];
}

export interface OrderEligibilityResult {
  eligible: boolean;
  reason?: string;
  eligibleSubOrders: EligibleSubOrder[];
}

export interface ValidatedReturnRequest {
  subOrder: any;
  masterOrder: any;
  validatedItems: Array<{
    orderItemId: string;
    quantity: number;
    orderItem: any;
  }>;
}

@Injectable()
export class ReturnEligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RETURN_REPOSITORY)
    private readonly returnRepo: ReturnRepository,
  ) {}

  async checkOrderEligibility(
    masterOrderId: string,
    customerId: string,
  ): Promise<OrderEligibilityResult> {
    // 1. Find master order via OrdersPublicFacade (respects module boundary)
    const masterOrder = await this.prisma.masterOrder.findFirst({
      where: { id: masterOrderId, customerId },
      include: {
        subOrders: {
          where: { fulfillmentStatus: 'DELIVERED' },
          include: { items: true },
        },
      },
    });
    // TODO: Replace with ordersFacade.getMasterOrderWithDeliveredSubOrders(masterOrderId, customerId)
    // once circular dependency between Returns → Orders is resolved via forwardRef

    if (!masterOrder) {
      return {
        eligible: false,
        reason: 'Order not found',
        eligibleSubOrders: [],
      };
    }
    if (masterOrder.subOrders.length === 0) {
      return {
        eligible: false,
        reason: 'No delivered items in this order',
        eligibleSubOrders: [],
      };
    }

    // 2. For each delivered sub-order, check return window and per-item eligibility
    const now = new Date();
    const eligibleSubOrders: EligibleSubOrder[] = await Promise.all(
      masterOrder.subOrders.map(async (subOrder) => {
        const windowExpired = subOrder.returnWindowEndsAt
          ? now > subOrder.returnWindowEndsAt
          : false;

        const items: EligibleItem[] = await Promise.all(
          subOrder.items.map(async (item) => {
            const alreadyReturnedQty =
              await this.returnRepo.getReturnedQuantityForOrderItem(item.id);
            const availableForReturn = item.quantity - alreadyReturnedQty;
            return {
              orderItemId: item.id,
              productTitle: item.productTitle,
              variantTitle: item.variantTitle,
              sku: item.sku,
              imageUrl: item.imageUrl,
              quantity: item.quantity,
              unitPrice: Number(item.unitPrice),
              alreadyReturnedQty,
              availableForReturn,
              eligible: !windowExpired && availableForReturn > 0,
            };
          }),
        );

        return {
          subOrderId: subOrder.id,
          orderNumber: masterOrder.orderNumber,
          deliveredAt: subOrder.deliveredAt,
          returnWindowEndsAt: subOrder.returnWindowEndsAt,
          windowExpired,
          items,
        };
      }),
    );

    const hasEligibleItem = eligibleSubOrders.some((so) =>
      so.items.some((i) => i.eligible),
    );

    return {
      eligible: hasEligibleItem,
      reason: hasEligibleItem
        ? undefined
        : 'No eligible items for return (window expired or already returned)',
      eligibleSubOrders,
    };
  }

  async validateReturnRequest(input: {
    customerId: string;
    subOrderId: string;
    items: Array<{ orderItemId: string; quantity: number }>;
  }): Promise<ValidatedReturnRequest> {
    // Find sub-order, verify customer owns it
    const subOrder = await this.prisma.subOrder.findFirst({
      where: { id: input.subOrderId },
      include: {
        masterOrder: true,
        items: true,
      },
    });

    if (!subOrder) {
      throw new NotFoundAppException('Sub-order not found');
    }
    if (subOrder.masterOrder.customerId !== input.customerId) {
      throw new ForbiddenAppException('You do not own this order');
    }
    if (subOrder.fulfillmentStatus !== 'DELIVERED') {
      throw new BadRequestAppException('Can only return delivered orders');
    }

    // Check return window
    const now = new Date();
    if (subOrder.returnWindowEndsAt && now > subOrder.returnWindowEndsAt) {
      throw new BadRequestAppException('Return window has expired');
    }

    // Validate each item
    const validatedItems: ValidatedReturnRequest['validatedItems'] = [];
    for (const requestedItem of input.items) {
      const orderItem = subOrder.items.find(
        (i) => i.id === requestedItem.orderItemId,
      );
      if (!orderItem) {
        throw new BadRequestAppException(
          `Order item ${requestedItem.orderItemId} not found in sub-order`,
        );
      }
      if (requestedItem.quantity < 1) {
        throw new BadRequestAppException('Return quantity must be at least 1');
      }
      const alreadyReturnedQty =
        await this.returnRepo.getReturnedQuantityForOrderItem(orderItem.id);
      const availableForReturn = orderItem.quantity - alreadyReturnedQty;
      if (requestedItem.quantity > availableForReturn) {
        throw new BadRequestAppException(
          `Cannot return ${requestedItem.quantity} of ${orderItem.productTitle}. Only ${availableForReturn} available for return.`,
        );
      }
      validatedItems.push({
        orderItemId: requestedItem.orderItemId,
        quantity: requestedItem.quantity,
        orderItem,
      });
    }

    return {
      subOrder,
      masterOrder: subOrder.masterOrder,
      validatedItems,
    };
  }
}
