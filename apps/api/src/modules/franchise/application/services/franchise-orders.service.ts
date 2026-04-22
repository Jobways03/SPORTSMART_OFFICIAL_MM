import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { FranchiseInventoryService } from './franchise-inventory.service';
import { FranchiseCommissionService } from './franchise-commission.service';
import { CatalogPublicFacade } from '../../../catalog/application/facades/catalog-public.facade';

const RETURN_WINDOW_MS = 2 * 60 * 1000; // 2 minutes (matches orders module)
const ACCEPT_DEADLINE_MS = 24 * 60 * 60 * 1000; // 24 hours
const DISPATCH_DEADLINE_HOURS = 48;

@Injectable()
export class FranchiseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: FranchiseInventoryService,
    private readonly commissionService: FranchiseCommissionService,
    private readonly catalogFacade: CatalogPublicFacade,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('FranchiseOrdersService');
  }

  // ── List orders assigned to franchise ──────────────────────────────────

  async listOrders(
    franchiseId: string,
    page: number,
    limit: number,
    filters?: {
      fulfillmentStatus?: string;
      acceptStatus?: string;
      search?: string;
    },
  ) {
    // Franchises see ALL their assigned sub-orders regardless of master order status.
    // The sub-order's own acceptStatus + fulfillmentStatus drive franchise actions.
    const where: Prisma.SubOrderWhereInput = {
      franchiseId,
      fulfillmentNodeType: 'FRANCHISE',
    };

    if (filters?.fulfillmentStatus) {
      where.fulfillmentStatus = filters.fulfillmentStatus as any;
    }
    if (filters?.acceptStatus) {
      where.acceptStatus = filters.acceptStatus as any;
    }
    if (filters?.search) {
      where.masterOrder = {
        orderNumber: {
          contains: filters.search,
          mode: 'insensitive',
        },
      };
    }

    const skip = (page - 1) * limit;

    const [subOrders, total] = await Promise.all([
      this.prisma.subOrder.findMany({
        where,
        include: {
          masterOrder: {
            select: {
              id: true,
              orderNumber: true,
              customerId: true,
              shippingAddressSnapshot: true,
              totalAmount: true,
              paymentMethod: true,
              paymentStatus: true,
              orderStatus: true,
              createdAt: true,
            },
          },
          items: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.subOrder.count({ where }),
    ]);

    return {
      subOrders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ── Get single order detail ────────────────────────────────────────────

  async getOrder(subOrderId: string, franchiseId: string) {
    const subOrder = await this.prisma.subOrder.findFirst({
      where: {
        id: subOrderId,
        franchiseId,
        fulfillmentNodeType: 'FRANCHISE',
      },
      include: {
        masterOrder: {
          select: {
            id: true,
            orderNumber: true,
            customerId: true,
            shippingAddressSnapshot: true,
            totalAmount: true,
            paymentMethod: true,
            paymentStatus: true,
            orderStatus: true,
            createdAt: true,
          },
        },
        items: true,
      },
    });

    if (!subOrder) {
      throw new NotFoundAppException('Order not found');
    }
    return subOrder;
  }

  // ── Accept order ──────────────────────────────────────────────────────

  async acceptOrder(
    subOrderId: string,
    franchiseId: string,
    options?: { expectedDispatchDate?: string },
  ) {
    const subOrder = await this.prisma.subOrder.findFirst({
      where: {
        id: subOrderId,
        franchiseId,
        fulfillmentNodeType: 'FRANCHISE',
      },
    });
    if (!subOrder) {
      throw new NotFoundAppException('Order not found');
    }
    if (subOrder.acceptStatus !== 'OPEN') {
      throw new BadRequestAppException(
        `Order is already ${subOrder.acceptStatus}`,
      );
    }

    // Check franchise contract expiry before accepting
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: { contractEndDate: true, status: true },
    });
    if (franchise?.contractEndDate && new Date() > franchise.contractEndDate) {
      throw new ForbiddenAppException(
        'Franchise contract has expired — cannot accept orders',
      );
    }

    const updateData: any = { acceptStatus: 'ACCEPTED' };
    updateData.expectedDispatchDate = options?.expectedDispatchDate
      ? new Date(options.expectedDispatchDate)
      : new Date(Date.now() + DISPATCH_DEADLINE_HOURS * 60 * 60 * 1000);

    const updated = await this.prisma.subOrder.update({
      where: { id: subOrderId },
      data: updateData,
    });

    // Update master order status to SELLER_ACCEPTED
    await this.prisma.masterOrder.update({
      where: { id: subOrder.masterOrderId },
      data: { orderStatus: 'SELLER_ACCEPTED' },
    });

    // Publish event (fire-and-forget)
    this.eventBus
      .publish({
        eventName: 'franchise.order.accepted',
        aggregate: 'SubOrder',
        aggregateId: subOrderId,
        occurredAt: new Date(),
        payload: {
          subOrderId,
          franchiseId,
          masterOrderId: subOrder.masterOrderId,
        },
      })
      .catch(() => {});

    return updated;
  }

  // ── Reject order — unreserve stock, attempt reassignment ──────────────

  async rejectOrder(
    subOrderId: string,
    franchiseId: string,
    options?: { reason?: string; note?: string },
  ) {
    const subOrder = await this.prisma.subOrder.findFirst({
      where: {
        id: subOrderId,
        franchiseId,
        fulfillmentNodeType: 'FRANCHISE',
      },
      include: {
        items: true,
        masterOrder: {
          select: {
            id: true,
            orderNumber: true,
            customerId: true,
            shippingAddressSnapshot: true,
          },
        },
      },
    });
    if (!subOrder) {
      throw new NotFoundAppException('Order not found');
    }
    if (subOrder.acceptStatus !== 'OPEN') {
      throw new BadRequestAppException(
        `Order is already ${subOrder.acceptStatus}`,
      );
    }

    // Mark current sub-order as rejected + cancelled
    await this.prisma.subOrder.update({
      where: { id: subOrderId },
      data: {
        acceptStatus: 'REJECTED',
        fulfillmentStatus: 'CANCELLED',
        rejectionReason: options?.reason || null,
        rejectionNote: options?.note || null,
      },
    });

    // Unreserve franchise stock for each item via inventory ledger
    for (const item of subOrder.items) {
      try {
        await this.inventoryService.unreserveStock(
          franchiseId,
          item.productId,
          item.variantId,
          item.quantity,
          subOrder.masterOrder.id,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to unreserve stock for item ${item.id}: ${(err as Error).message}`,
        );
      }
    }

    // Check if max reassignment attempts have been exceeded
    const MAX_REASSIGNMENT_ATTEMPTS = 3;
    const previousRejectedSubOrders = await this.prisma.subOrder.count({
      where: {
        masterOrderId: subOrder.masterOrder.id,
        acceptStatus: 'REJECTED',
      },
    });

    if (previousRejectedSubOrders >= MAX_REASSIGNMENT_ATTEMPTS) {
      // Move to exception queue — no more reassignment
      await this.prisma.masterOrder.update({
        where: { id: subOrder.masterOrder.id },
        data: { orderStatus: 'EXCEPTION_QUEUE' },
      });
      this.logger.warn(
        `Order ${subOrder.masterOrder.id} moved to exception queue — max reassignment attempts (${MAX_REASSIGNMENT_ATTEMPTS}) exceeded`,
      );

      // Log the rejection
      this.prisma.orderReassignmentLog
        .create({
          data: {
            subOrderId,
            masterOrderId: subOrder.masterOrder.id,
            fromSellerId: franchiseId,
            toSellerId: null,
            reason: options?.reason || 'Franchise rejected the order',
            successful: false,
            newSubOrderId: null,
          },
        })
        .catch(() => {});

      this.eventBus
        .publish({
          eventName: 'franchise.order.rejected',
          aggregate: 'SubOrder',
          aggregateId: subOrderId,
          occurredAt: new Date(),
          payload: {
            subOrderId,
            franchiseId,
            masterOrderId: subOrder.masterOrder.id,
            reason: options?.reason,
            reassigned: false,
            movedToExceptionQueue: true,
          },
        })
        .catch(() => {});

      return {
        rejected: true,
        reassigned: false,
        newSubOrderId: null,
        message:
          'Order moved to exception queue — max reassignment attempts reached',
      };
    }

    // Attempt reassignment
    const addressSnapshot =
      subOrder.masterOrder.shippingAddressSnapshot as any;
    const customerPincode = addressSnapshot?.postalCode;

    let reassignmentSuccessful = false;
    let newSubOrderId: string | null = null;
    let newSellerId: string | null = null;

    if (customerPincode) {
      try {
        // Find ALL nodes that have already rejected this master order
        const previousRejections = await this.prisma.subOrder.findMany({
          where: { masterOrderId: subOrder.masterOrder.id },
          select: {
            sellerId: true,
            franchiseId: true,
            acceptStatus: true,
          },
        });

        const rejectedSellerIds = new Set(
          previousRejections
            .filter(
              (r) => r.acceptStatus === 'REJECTED' && r.sellerId,
            )
            .map((r) => r.sellerId!),
        );

        // Find all mapping IDs belonging to rejected sellers
        const rejectedMappingIds: string[] = [];
        for (const item of subOrder.items) {
          // Get mapping IDs of sellers who rejected (to exclude from reallocation)
          if (rejectedSellerIds.size > 0) {
            const mappings =
              await this.prisma.sellerProductMapping.findMany({
                where: {
                  productId: item.productId,
                  ...(item.variantId
                    ? { variantId: item.variantId }
                    : {}),
                  sellerId: { in: Array.from(rejectedSellerIds) },
                },
                select: { id: true },
              });
            rejectedMappingIds.push(...mappings.map((m) => m.id));
          }
        }

        // Attempt reallocation for each item
        for (const item of subOrder.items) {
          const reallocation = await this.catalogFacade.allocate({
            productId: item.productId,
            variantId: item.variantId ?? undefined,
            customerPincode,
            quantity: item.quantity,
            excludeMappingIds: rejectedMappingIds,
          });

          if (reallocation.serviceable && reallocation.primary) {
            const primary = reallocation.primary;

            // Reserve stock on the new node — honour whichever nodeType
            // the allocation engine picked. Previously this branch assumed
            // SELLER and silently mis-routed franchise primaries; that's
            // fixed here.
            if (primary.nodeType === 'SELLER') {
              const reservation =
                await this.catalogFacade.reserveStock({
                  mappingId: primary.mappingId,
                  quantity: item.quantity,
                  orderId: subOrder.masterOrder.id,
                  expiresInMinutes: 60,
                });
              await this.catalogFacade.confirmReservation(
                reservation.id,
                subOrder.masterOrder.id,
              );
            } else {
              // Franchise → franchise handover. We just released this
              // rejecting franchise's stock above, so if the engine
              // picked the same one again (e.g. it's the only node in
              // range), the reserve here will fail and the item will
              // fall through to exception queue — which is the right
              // outcome.
              await this.inventoryService.reserveStock(
                primary.franchiseId!,
                item.productId,
                item.variantId ?? null,
                item.quantity,
                subOrder.masterOrder.id,
              );
            }

            const acceptDeadlineAt = new Date(
              Date.now() + ACCEPT_DEADLINE_MS,
            );
            const newSubOrder = await this.prisma.subOrder.create({
              data: {
                masterOrderId: subOrder.masterOrder.id,
                ...(primary.nodeType === 'SELLER'
                  ? { sellerId: primary.sellerId }
                  : { franchiseId: primary.franchiseId! }),
                fulfillmentNodeType: primary.nodeType,
                subTotal: Number(item.totalPrice),
                paymentStatus: subOrder.paymentStatus,
                fulfillmentStatus: 'UNFULFILLED',
                acceptStatus: 'OPEN',
                acceptDeadlineAt,
                items: {
                  create: {
                    productId: item.productId,
                    variantId: item.variantId,
                    productTitle: item.productTitle,
                    variantTitle: item.variantTitle,
                    sku: item.sku,
                    masterSku: (item as any).masterSku || item.sku,
                    imageUrl: item.imageUrl,
                    unitPrice: item.unitPrice,
                    quantity: item.quantity,
                    totalPrice: item.totalPrice,
                  },
                },
              },
            });

            reassignmentSuccessful = true;
            newSubOrderId = newSubOrder.id;
            newSellerId =
              primary.nodeType === 'SELLER'
                ? primary.sellerId
                : primary.franchiseId!;

            // Publish event for new node notification
            this.eventBus
              .publish({
                eventName: 'orders.sub_order.created',
                aggregate: 'SubOrder',
                aggregateId: newSubOrder.id,
                occurredAt: new Date(),
                payload: {
                  subOrderId: newSubOrder.id,
                  masterOrderId: subOrder.masterOrder.id,
                  orderNumber: subOrder.masterOrder.orderNumber,
                  sellerId:
                    primary.nodeType === 'SELLER'
                      ? primary.sellerId
                      : null,
                  sellerName:
                    primary.nodeType === 'SELLER'
                      ? primary.sellerName
                      : null,
                  franchiseId:
                    primary.nodeType === 'FRANCHISE'
                      ? primary.franchiseId
                      : null,
                  nodeType: primary.nodeType,
                  subTotal: Number(item.totalPrice),
                  itemCount: item.quantity,
                  isReassignment: true,
                  reassignedFromFranchise: franchiseId,
                },
              })
              .catch(() => {});
          }
        }
      } catch (err) {
        this.logger.warn(
          `Reassignment failed after franchise rejection: ${(err as Error).message}`,
        );
        // Continue with exception queue below
      }
    }

    // If no reassignment was possible, move master order to EXCEPTION_QUEUE
    if (!reassignmentSuccessful) {
      await this.prisma.masterOrder.update({
        where: { id: subOrder.masterOrder.id },
        data: { orderStatus: 'EXCEPTION_QUEUE' },
      });

      this.eventBus
        .publish({
          eventName: 'orders.master.exception',
          aggregate: 'MasterOrder',
          aggregateId: subOrder.masterOrder.id,
          occurredAt: new Date(),
          payload: {
            masterOrderId: subOrder.masterOrder.id,
            orderNumber: subOrder.masterOrder.orderNumber,
            customerId: subOrder.masterOrder.customerId,
            orderStatus: 'EXCEPTION_QUEUE',
            reason:
              'Franchise rejected and no alternative fulfillment node available — awaiting manual reassignment',
            rejectedSubOrderId: subOrderId,
            rejectedFranchiseId: franchiseId,
          },
        })
        .catch(() => {});
    }

    // Log the reassignment attempt
    this.prisma.orderReassignmentLog
      .create({
        data: {
          subOrderId,
          masterOrderId: subOrder.masterOrder.id,
          fromSellerId: franchiseId, // Using fromSellerId to store the originating node ID
          toSellerId: newSellerId,
          reason: options?.reason || 'Franchise rejected the order',
          successful: reassignmentSuccessful,
          newSubOrderId,
        },
      })
      .catch(() => {});

    // Publish rejection event
    this.eventBus
      .publish({
        eventName: 'franchise.order.rejected',
        aggregate: 'SubOrder',
        aggregateId: subOrderId,
        occurredAt: new Date(),
        payload: {
          subOrderId,
          franchiseId,
          masterOrderId: subOrder.masterOrder.id,
          reason: options?.reason,
          reassigned: reassignmentSuccessful,
          newSubOrderId,
        },
      })
      .catch(() => {});

    return {
      rejected: true,
      reassigned: reassignmentSuccessful,
      newSubOrderId,
      message: reassignmentSuccessful
        ? 'Order rejected and reassigned to another seller'
        : 'Order rejected — no alternative fulfillment node available, moved to exception queue for manual reassignment',
    };
  }

  // ── Update fulfillment status (UNFULFILLED -> PACKED -> SHIPPED) ──────

  async updateFulfillmentStatus(
    subOrderId: string,
    franchiseId: string,
    status: string,
    tracking?: { trackingNumber?: string; courierName?: string },
  ) {
    const subOrder = await this.prisma.subOrder.findFirst({
      where: {
        id: subOrderId,
        franchiseId,
        fulfillmentNodeType: 'FRANCHISE',
      },
      include: { items: true },
    });
    if (!subOrder) {
      throw new NotFoundAppException('Order not found');
    }
    if (subOrder.acceptStatus !== 'ACCEPTED') {
      throw new BadRequestAppException(
        'Order must be accepted before updating fulfillment status',
      );
    }

    // Franchise can only move: UNFULFILLED -> PACKED -> SHIPPED
    // DELIVERED must be confirmed by admin or webhook
    const validTransitions: Record<string, string[]> = {
      UNFULFILLED: ['PACKED'],
      PACKED: ['SHIPPED'],
    };

    const allowed =
      validTransitions[subOrder.fulfillmentStatus] || [];
    if (!allowed.includes(status)) {
      if (status === 'DELIVERED') {
        throw new BadRequestAppException(
          'Delivery must be confirmed by admin. Franchise can only update status up to SHIPPED.',
        );
      }
      throw new BadRequestAppException(
        `Cannot transition from ${subOrder.fulfillmentStatus} to ${status}. Allowed: ${allowed.join(', ') || 'none (franchise flow complete)'}`,
      );
    }

    // On SHIPPED: confirm shipment via inventory ledger for each item
    if (status === 'SHIPPED') {
      for (const item of subOrder.items) {
        try {
          await this.inventoryService.confirmShipment(
            franchiseId,
            item.productId,
            item.variantId,
            item.quantity,
            subOrder.masterOrderId,
          );
        } catch (err) {
          this.logger.warn(
            `Failed to confirm shipment for item ${item.id}: ${(err as Error).message}`,
          );
        }
      }
    }

    const updatePayload: any = { fulfillmentStatus: status as any };
    if (status === 'SHIPPED' && tracking) {
      if (tracking.trackingNumber) updatePayload.trackingNumber = tracking.trackingNumber;
      if (tracking.courierName) updatePayload.courierName = tracking.courierName;
    }

    const updated = await this.prisma.subOrder.update({
      where: { id: subOrderId },
      data: updatePayload,
    });

    // Update master order status to DISPATCHED if SHIPPED
    if (status === 'SHIPPED') {
      await this.prisma.masterOrder.update({
        where: { id: subOrder.masterOrderId },
        data: { orderStatus: 'DISPATCHED' },
      });
    }

    // Publish fulfillment status change event
    this.eventBus
      .publish({
        eventName: 'franchise.order.status_changed',
        aggregate: 'SubOrder',
        aggregateId: subOrderId,
        occurredAt: new Date(),
        payload: {
          subOrderId,
          franchiseId,
          previousStatus: subOrder.fulfillmentStatus,
          newStatus: status,
        },
      })
      .catch(() => {});

    return updated;
  }

  // ── Mark delivered (admin action or auto via shipping webhook) ─────────

  async markDelivered(subOrderId: string) {
    const subOrder = await this.prisma.subOrder.findFirst({
      where: {
        id: subOrderId,
        fulfillmentNodeType: 'FRANCHISE',
      },
    });
    if (!subOrder) {
      throw new NotFoundAppException('Order not found');
    }

    const now = new Date();

    const updated = await this.prisma.subOrder.update({
      where: { id: subOrderId },
      data: {
        fulfillmentStatus: 'DELIVERED',
        deliveredAt: now,
        returnWindowEndsAt: new Date(now.getTime() + RETURN_WINDOW_MS),
      },
    });

    // Update master order status to DELIVERED
    await this.prisma.masterOrder.update({
      where: { id: subOrder.masterOrderId },
      data: { orderStatus: 'DELIVERED' },
    });

    // Publish delivery event
    this.eventBus
      .publish({
        eventName: 'franchise.order.delivered',
        aggregate: 'SubOrder',
        aggregateId: subOrderId,
        occurredAt: now,
        payload: {
          subOrderId,
          franchiseId: subOrder.franchiseId,
          masterOrderId: subOrder.masterOrderId,
          deliveredAt: now.toISOString(),
        },
      })
      .catch(() => {});

    return updated;
  }

  // ── Initiate return for franchise-fulfilled order ─────────────

  async initiateReturn(
    subOrderId: string,
    input: {
      items: Array<{ orderItemId: string; quantity: number; reason: string }>;
      initiatedBy: 'CUSTOMER' | 'FRANCHISE' | 'ADMIN';
      initiatorId: string;
    },
  ) {
    // 1. Find sub-order with items
    const subOrder = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      include: { items: true, masterOrder: true },
    });
    if (!subOrder || subOrder.fulfillmentNodeType !== 'FRANCHISE') {
      throw new NotFoundAppException('Franchise order not found');
    }
    if (subOrder.fulfillmentStatus !== 'DELIVERED') {
      throw new BadRequestAppException('Can only return delivered orders');
    }
    // Check return window
    if (subOrder.returnWindowEndsAt && new Date() > subOrder.returnWindowEndsAt) {
      throw new BadRequestAppException('Return window has expired');
    }

    // 2. Validate and return stock for each item
    for (const returnItem of input.items) {
      const orderItem = subOrder.items.find((i) => i.id === returnItem.orderItemId);
      if (!orderItem) {
        throw new NotFoundAppException(`Order item ${returnItem.orderItemId} not found`);
      }
      if (returnItem.quantity > orderItem.quantity) {
        throw new BadRequestAppException('Cannot return more than ordered quantity');
      }

      // Return stock to franchise via inventory ledger
      await this.inventoryService.recordReturn(
        subOrder.franchiseId!,
        orderItem.productId,
        orderItem.variantId || null,
        returnItem.quantity,
        subOrderId,
      );
    }

    // 3. Update sub-order fulfillment status
    await this.prisma.subOrder.update({
      where: { id: subOrderId },
      data: { fulfillmentStatus: 'CANCELLED' },
    });

    // 4. Publish return event
    this.eventBus
      .publish({
        eventName: 'franchise.order.returned',
        aggregate: 'SubOrder',
        aggregateId: subOrderId,
        occurredAt: new Date(),
        payload: {
          subOrderId,
          franchiseId: subOrder.franchiseId,
          items: input.items,
          initiatedBy: input.initiatedBy,
        },
      })
      .catch(() => {});

    // 5. Attempt commission reversal — proportional to the returned value.
    //
    // The prior implementation reversed the FULL franchise earning for the
    // sub-order regardless of whether the customer returned 1 of 3 items
    // or all 3. That over-credited the platform (under-paid the franchise)
    // on every partial counter-return. The fix below computes the gross
    // value of the returned items and scales the reversal by that share
    // of the sub-order's gross. Quantity and unitPrice come from the
    // OrderItem rows we already loaded at line 734.
    //
    // Note: this path is the counter-return shortcut — franchise has
    // physically inspected the items at the store and is recording the
    // return immediately. It deliberately skips the Return/QC pipeline
    // used by customer-initiated online returns (which has its own
    // reversal path gated on qcQuantityApproved > 0).
    try {
      const originalEntry = await this.prisma.franchiseFinanceLedger.findFirst({
        where: {
          franchiseId: subOrder.franchiseId!,
          sourceId: subOrderId,
          sourceType: 'ONLINE_ORDER',
          status: { in: ['ACCRUED', 'PENDING'] },
        },
      });

      if (originalEntry) {
        // Returned-item gross
        let returnedGross = 0;
        for (const ri of input.items) {
          const oi = subOrder.items.find((i) => i.id === ri.orderItemId);
          if (!oi) continue;
          returnedGross += ri.quantity * Number(oi.unitPrice);
        }

        // Sub-order gross (for proportion denominator)
        const subOrderGross = subOrder.items.reduce(
          (acc, i) => acc + i.quantity * Number(i.unitPrice),
          0,
        );

        if (subOrderGross > 0 && returnedGross > 0) {
          const fullFranchiseEarning = Number(originalEntry.franchiseEarning);
          const proportion = returnedGross / subOrderGross;
          const reversalAmount =
            Math.round(fullFranchiseEarning * proportion * 100) / 100;

          if (reversalAmount > 0) {
            await this.commissionService.recordReturnReversal({
              franchiseId: subOrder.franchiseId!,
              originalLedgerEntryId: originalEntry.id,
              subOrderId,
              reversalAmount,
            });
          }
        }
      }
    } catch (err) {
      this.logger.warn(
        `Commission reversal failed for return on ${subOrderId}: ${(err as Error).message}`,
      );
    }

    return { success: true, subOrderId, returnedItems: input.items.length };
  }

  // ── Find stale accepted orders (accepted > 48h, not shipped) ──

  async findStaleAcceptedOrders(franchiseId: string) {
    const cutoff = new Date(Date.now() - DISPATCH_DEADLINE_HOURS * 60 * 60 * 1000);
    return this.prisma.subOrder.findMany({
      where: {
        franchiseId,
        fulfillmentNodeType: 'FRANCHISE',
        acceptStatus: 'ACCEPTED',
        fulfillmentStatus: 'UNFULFILLED',
        updatedAt: { lt: cutoff },
      },
      include: {
        masterOrder: {
          select: {
            id: true,
            orderNumber: true,
            shippingAddressSnapshot: true,
            createdAt: true,
          },
        },
        items: true,
      },
      orderBy: { updatedAt: 'asc' },
    });
  }
}
