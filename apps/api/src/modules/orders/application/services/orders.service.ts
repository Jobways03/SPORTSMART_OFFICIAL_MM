import { Inject, Injectable } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { Prisma } from '@prisma/client';
import {
  CatalogPublicFacade,
} from '../../../catalog/application/facades/catalog-public.facade';
import { FranchisePublicFacade } from '../../../franchise/application/facades/franchise-public.facade';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  OrderRepository,
  ORDER_REPOSITORY,
} from '../../domain/repositories/order.repository.interface';
import { assertTransition } from '../../../../core/fsm/status-transitions';

export type ReassignTarget =
  | { nodeType: 'SELLER'; nodeId: string }
  | { nodeType: 'FRANCHISE'; nodeId: string };

const RETURN_WINDOW_MS = 2 * 60 * 1000; // 2 minutes (dev/demo — commission fires shortly after delivery)
const ACCEPT_DEADLINE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Customer-friendly status label mapping
const ORDER_STATUS_LABELS: Record<string, string> = {
  PLACED: 'Order Placed',
  PENDING_VERIFICATION: 'Processing',
  VERIFIED: 'Order Confirmed',
  ROUTED_TO_SELLER: 'Being Prepared',
  SELLER_ACCEPTED: 'Order Accepted',
  PACKED: 'Packed & Ready',
  SHIPPED: 'Shipped',
  DISPATCHED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  EXCEPTION_QUEUE: 'Processing',
};

@Injectable()
export class OrdersService {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepo: OrderRepository,
    private readonly eventBus: EventBusService,
    private readonly catalogFacade: CatalogPublicFacade,
    private readonly franchiseFacade: FranchisePublicFacade,
    private readonly prisma: PrismaService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────
  // Admin methods
  // ────────────────────────────────────────────────────────────────────────

  async listOrders(filters: {
    page: number;
    limit: number;
    paymentStatus?: string;
    fulfillmentStatus?: string;
    acceptStatus?: string;
    orderStatus?: string;
    search?: string;
  }) {
    const {
      page,
      limit,
      paymentStatus,
      fulfillmentStatus,
      acceptStatus,
      orderStatus,
      search,
    } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.MasterOrderWhereInput = {};
    if (paymentStatus) where.paymentStatus = paymentStatus as any;
    if (orderStatus) where.orderStatus = orderStatus as any;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        {
          customer: {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const subOrderFilter: Prisma.SubOrderWhereInput = {};
    if (fulfillmentStatus)
      subOrderFilter.fulfillmentStatus = fulfillmentStatus as any;
    if (acceptStatus) subOrderFilter.acceptStatus = acceptStatus as any;
    if (Object.keys(subOrderFilter).length > 0)
      where.subOrders = { some: subOrderFilter };

    const [orders, total] = await Promise.all([
      this.orderRepo.findMasterOrders(where, skip, limit),
      this.orderRepo.countMasterOrders(where),
    ]);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getOrder(id: string) {
    const order = await this.orderRepo.findMasterOrderByIdWithDetails(id);
    if (!order) throw new NotFoundAppException('Order not found');

    // Include reassignment history
    const reassignmentLogs =
      await this.orderRepo.findReassignmentLogs(id);

    // Enrich logs with seller names
    const enrichedLogs = await Promise.all(
      reassignmentLogs.map(async (log: any) => {
        const [fromSeller, toSeller] = await Promise.all([
          this.orderRepo.findSeller(log.fromSellerId),
          log.toSellerId
            ? this.orderRepo.findSeller(log.toSellerId)
            : null,
        ]);
        return {
          ...log,
          fromSellerName:
            fromSeller?.sellerShopName ||
            fromSeller?.sellerName ||
            log.fromSellerId,
          toSellerName:
            toSeller?.sellerShopName ||
            toSeller?.sellerName ||
            log.toSellerId ||
            'N/A',
        };
      }),
    );

    // When a coupon was applied, look up the underlying Discount so the
    // super-admin order detail can explain exactly what rule fired.
    let discount: any = null;
    if (order.discountCode) {
      discount = await this.prisma.discount.findUnique({
        where: { code: order.discountCode },
        include: {
          products: {
            include: {
              product: {
                select: {
                  id: true,
                  title: true,
                  basePrice: true,
                  images: {
                    where: { isPrimary: true },
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

    return { ...order, reassignmentLogs: enrichedLogs, discount };
  }

  /**
   * Verify an order: validate, set status to VERIFIED, then attempt allocation.
   * If all items are serviceable, confirm reservations and route to sellers.
   * If some items are unserviceable, move to EXCEPTION_QUEUE.
   */
  async verifyOrder(id: string, adminId: string, remarks?: string) {
    const order = await this.orderRepo.findMasterOrderById(id);
    if (!order) throw new NotFoundAppException('Order not found');
    if (order.orderStatus !== 'PLACED') {
      throw new BadRequestAppException(
        `Cannot verify order — current status is ${order.orderStatus}, expected PLACED`,
      );
    }
    if (order.paymentStatus === 'CANCELLED') {
      throw new BadRequestAppException('Cannot verify a cancelled order');
    }

    const now = new Date();

    // Step 1: Mark as VERIFIED with admin info
    await this.orderRepo.updateMasterOrder(id, {
      orderStatus: 'VERIFIED',
      verified: true,
      verifiedAt: now,
      verifiedBy: adminId,
      verificationRemarks: remarks || null,
    });

    // Step 2: Attempt allocation for each sub-order's items
    const addressSnapshot = order.shippingAddressSnapshot as any;
    const customerPincode = addressSnapshot?.postalCode;

    if (!customerPincode) {
      // No pincode available — cannot route, move to exception queue
      await this.orderRepo.updateMasterOrder(id, {
        orderStatus: 'EXCEPTION_QUEUE',
      });
      return this.getOrder(id);
    }

    let allRoutedSuccessfully = true;
    const acceptDeadlineAt = new Date(now.getTime() + ACCEPT_DEADLINE_MS);

    for (const subOrder of order.subOrders) {
      let subOrderServiceable = true;

      for (const item of subOrder.items) {
        try {
          // Run allocation to verify seller can still service this item
          const allocation = await this.catalogFacade.allocate({
            productId: item.productId,
            variantId: item.variantId ?? undefined,
            customerPincode,
            quantity: item.quantity,
          });

          if (!allocation.serviceable || !allocation.primary) {
            subOrderServiceable = false;
            break;
          }
        } catch {
          // Allocation threw — item is unserviceable
          subOrderServiceable = false;
          break;
        }
      }

      if (!subOrderServiceable) {
        allRoutedSuccessfully = false;
        continue;
      }

      // Set accept deadline on successfully routed sub-orders
      await this.orderRepo.updateSubOrder(subOrder.id, { acceptDeadlineAt });
    }

    // Step 3: Set final order status based on routing results
    if (allRoutedSuccessfully) {
      await this.orderRepo.updateMasterOrder(id, {
        orderStatus: 'ROUTED_TO_SELLER',
      });

      // Publish domain event for routing
      try {
        await this.eventBus.publish({
          eventName: 'orders.master.routed',
          aggregate: 'MasterOrder',
          aggregateId: id,
          occurredAt: now,
          payload: {
            masterOrderId: id,
            orderNumber: order.orderNumber,
            customerId: order.customerId,
            orderStatus: 'ROUTED_TO_SELLER',
            verifiedBy: adminId,
            subOrderCount: order.subOrders.length,
          },
        });
      } catch {
        // Events are best-effort
      }
    } else {
      await this.orderRepo.updateMasterOrder(id, {
        orderStatus: 'EXCEPTION_QUEUE',
      });

      // Publish exception event
      try {
        await this.eventBus.publish({
          eventName: 'orders.master.exception',
          aggregate: 'MasterOrder',
          aggregateId: id,
          occurredAt: now,
          payload: {
            masterOrderId: id,
            orderNumber: order.orderNumber,
            customerId: order.customerId,
            orderStatus: 'EXCEPTION_QUEUE',
            reason: 'Some items are unserviceable after verification',
          },
        });
      } catch {
        // Events are best-effort
      }
    }

    return this.getOrder(id);
  }

  async rejectOrder(id: string) {
    const order = await this.orderRepo.findMasterOrderById(id);
    if (!order) throw new NotFoundAppException('Order not found');
    if (
      order.orderStatus === 'ROUTED_TO_SELLER' ||
      order.orderStatus === 'SELLER_ACCEPTED' ||
      order.orderStatus === 'DISPATCHED' ||
      order.orderStatus === 'DELIVERED'
    ) {
      throw new BadRequestAppException(
        'Cannot reject an order that has already been routed or fulfilled',
      );
    }
    if (order.paymentStatus === 'CANCELLED')
      throw new BadRequestAppException('Order is already cancelled');

    await this.orderRepo.executeTransaction(async (tx) => {
      await tx.masterOrder.update({
        where: { id },
        data: { paymentStatus: 'CANCELLED', orderStatus: 'CANCELLED' },
      });

      for (const so of order.subOrders) {
        await tx.subOrder.update({
          where: { id: so.id },
          data: {
            paymentStatus: 'CANCELLED',
            acceptStatus: 'REJECTED',
            commissionProcessed: true,
          },
        });

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
        }
      }
    });
  }

  async acceptSubOrder(id: string) {
    const subOrder = await this.orderRepo.findSubOrderById(id);
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');
    return this.orderRepo.updateSubOrder(id, { acceptStatus: 'ACCEPTED' });
  }

  async rejectSubOrder(id: string) {
    const subOrder = await this.orderRepo.findSubOrderById(id);
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');
    return this.orderRepo.updateSubOrder(id, { acceptStatus: 'REJECTED' });
  }

  async fulfillSubOrder(id: string) {
    const subOrder = await this.orderRepo.findSubOrderById(id);
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');
    return this.orderRepo.updateSubOrder(id, {
      fulfillmentStatus: 'FULFILLED',
    });
  }

  /**
   * Seller-initiated return — parallel to franchiseOrdersService.initiateReturn.
   * Returns stock to the seller's SellerProductMapping.stockQty and marks
   * the sub-order CANCELLED. Does NOT create a Return row; customer-initiated
   * returns keep their own lifecycle in the returns module.
   */
  async sellerInitiateReturn(
    subOrderId: string,
    sellerId: string,
    items: Array<{ orderItemId: string; quantity: number; reason: string }>,
  ) {
    const subOrder = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      include: { items: true, masterOrder: true },
    });

    if (!subOrder || subOrder.fulfillmentNodeType !== 'SELLER') {
      throw new NotFoundAppException('Seller order not found');
    }
    if (subOrder.sellerId !== sellerId) {
      throw new NotFoundAppException('Seller order not found');
    }
    if (subOrder.fulfillmentStatus !== 'DELIVERED') {
      throw new BadRequestAppException('Can only return delivered orders');
    }
    if (
      subOrder.returnWindowEndsAt &&
      new Date() > subOrder.returnWindowEndsAt
    ) {
      throw new BadRequestAppException('Return window has expired');
    }
    if (!items || items.length === 0) {
      throw new BadRequestAppException('At least one item is required');
    }

    // Validate + return stock in a single transaction so we don't leave
    // half-updated state if any item lookup fails.
    await this.prisma.$transaction(async (tx) => {
      for (const returnItem of items) {
        const orderItem = subOrder.items.find(
          (i) => i.id === returnItem.orderItemId,
        );
        if (!orderItem) {
          throw new NotFoundAppException(
            `Order item ${returnItem.orderItemId} not found`,
          );
        }
        if (returnItem.quantity <= 0) {
          throw new BadRequestAppException('Return quantity must be positive');
        }
        if (returnItem.quantity > orderItem.quantity) {
          throw new BadRequestAppException(
            'Cannot return more than ordered quantity',
          );
        }

        const mapping = await tx.sellerProductMapping.findFirst({
          where: {
            sellerId,
            productId: orderItem.productId,
            variantId: orderItem.variantId,
          },
        });
        if (mapping) {
          await tx.sellerProductMapping.update({
            where: { id: mapping.id },
            data: { stockQty: { increment: returnItem.quantity } },
          });
        }
      }

      await tx.subOrder.update({
        where: { id: subOrderId },
        data: { fulfillmentStatus: 'CANCELLED' },
      });
    });

    await this.eventBus
      .publish({
        eventName: 'orders.sub_order.returned_by_seller',
        aggregate: 'SubOrder',
        aggregateId: subOrderId,
        occurredAt: new Date(),
        payload: {
          subOrderId,
          masterOrderId: subOrder.masterOrderId,
          orderNumber: subOrder.masterOrder.orderNumber,
          sellerId,
          items: items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity })),
        },
      })
      .catch(() => {});

    return {
      subOrderId,
      fulfillmentStatus: 'CANCELLED',
      itemsReturned: items.length,
    };
  }

  /**
   * Admin-initiated mid-flow sub-order cancel. Reverses any outstanding
   * seller/franchise stock hold, releases reservations (if still in
   * pre-delivery states), marks the sub-order CANCELLED, and publishes an
   * event. Callers that need to cancel an entire master order can call this
   * per-sub-order.
   */
  async adminCancelSubOrder(subOrderId: string, adminId: string, reason?: string) {
    const subOrder =
      await this.orderRepo.findSubOrderByIdWithItems(subOrderId);
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');

    if (subOrder.fulfillmentStatus === 'DELIVERED') {
      throw new BadRequestAppException(
        'Cannot cancel a DELIVERED sub-order — use the return flow instead',
      );
    }
    if (subOrder.fulfillmentStatus === 'CANCELLED') {
      throw new BadRequestAppException('Sub-order is already cancelled');
    }

    const nodeType = (subOrder as any).fulfillmentNodeType || 'SELLER';
    const sellerId: string | null = subOrder.sellerId ?? null;
    const franchiseId: string | null = (subOrder as any).franchiseId ?? null;

    // Release stock holds. For seller: use stock reservations. For
    // franchise: route through the franchise facade which handles ledger
    // writes + reservedQty bookkeeping.
    if (nodeType === 'SELLER' && sellerId) {
      await this.orderRepo.executeTransaction(async (tx) => {
        const currentReservations = await tx.stockReservation.findMany({
          where: {
            orderId: subOrder.masterOrder.id,
            status: { in: ['RESERVED', 'CONFIRMED'] },
            mapping: { sellerId },
          },
        });
        for (const res of currentReservations) {
          if (res.status === 'CONFIRMED') {
            await tx.stockReservation.update({
              where: { id: res.id },
              data: { status: 'RELEASED' },
            });
            await tx.sellerProductMapping.update({
              where: { id: res.mappingId },
              data: { stockQty: { increment: res.quantity } },
            });
          } else {
            await tx.stockReservation.update({
              where: { id: res.id },
              data: { status: 'RELEASED' },
            });
            await tx.sellerProductMapping.update({
              where: { id: res.mappingId },
              data: { reservedQty: { decrement: res.quantity } },
            });
          }
        }
      });
    } else if (nodeType === 'FRANCHISE' && franchiseId) {
      for (const item of subOrder.items) {
        await this.franchiseFacade
          .unreserveStock(
            franchiseId,
            item.productId,
            item.variantId ?? null,
            item.quantity,
            subOrder.masterOrder.id,
          )
          .catch(() => {});
      }
    }

    const now = new Date();
    const updated = await this.orderRepo.updateSubOrder(subOrderId, {
      fulfillmentStatus: 'CANCELLED',
      acceptStatus: 'CANCELLED',
    });

    await this.eventBus
      .publish({
        eventName: 'orders.sub_order.cancelled_by_admin',
        aggregate: 'SubOrder',
        aggregateId: subOrderId,
        occurredAt: now,
        payload: {
          subOrderId,
          masterOrderId: subOrder.masterOrder.id,
          orderNumber: subOrder.masterOrder.orderNumber,
          adminId,
          previousFulfillmentStatus: subOrder.fulfillmentStatus,
          nodeType,
          sellerId,
          franchiseId,
          reason: reason ?? 'Admin cancellation',
        },
      })
      .catch(() => {});

    return updated;
  }

  async deliverSubOrder(id: string) {
    const subOrder =
      await this.orderRepo.findSubOrderByIdWithMasterOrder(id);
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');

    // FSM enforcement — also catches anyone calling this from a stale
    // background job with an outdated cached status. The ad-hoc check
    // below is kept as defense-in-depth and produces a clearer error
    // message for the common case.
    assertTransition(
      'OrderFulfillmentStatus',
      subOrder.fulfillmentStatus,
      'DELIVERED',
    );

    if (subOrder.fulfillmentStatus !== 'SHIPPED') {
      throw new BadRequestAppException(
        `Cannot mark as delivered — sub-order fulfillment status is ${subOrder.fulfillmentStatus}, expected SHIPPED`,
      );
    }

    const now = new Date();
    const updated = await this.orderRepo.updateSubOrder(id, {
      fulfillmentStatus: 'DELIVERED',
      deliveredAt: now,
      returnWindowEndsAt: new Date(now.getTime() + RETURN_WINDOW_MS),
    });

    // Check if ALL active (non-rejected) sub-orders are now DELIVERED
    const activeSubOrders = subOrder.masterOrder.subOrders.filter(
      (so: any) => so.acceptStatus !== 'REJECTED',
    );
    const allDelivered = activeSubOrders.every((so: any) =>
      so.id === id ? true : so.fulfillmentStatus === 'DELIVERED',
    );

    if (allDelivered) {
      await this.orderRepo.updateMasterOrder(subOrder.masterOrderId, {
        orderStatus: 'DELIVERED',
      });
    }

    // Publish delivery event (best-effort)
    await this.eventBus
      .publish({
        eventName: 'orders.sub_order.delivered',
        aggregate: 'SubOrder',
        aggregateId: id,
        occurredAt: now,
        payload: {
          subOrderId: id,
          masterOrderId: subOrder.masterOrderId,
          sellerId: subOrder.sellerId,
          deliveredAt: now.toISOString(),
          returnWindowEndsAt: new Date(
            now.getTime() + RETURN_WINDOW_MS,
          ).toISOString(),
          allDelivered,
        },
      })
      .catch(() => {});

    return updated;
  }

  async markAsPaid(id: string) {
    const order = await this.orderRepo.findMasterOrderById(id);
    if (!order) throw new NotFoundAppException('Order not found');

    // Only consider active (non-rejected) sub-orders
    const activeSubOrders = order.subOrders.filter(
      (so: any) => so.acceptStatus !== 'REJECTED',
    );
    const relevantSubOrders =
      activeSubOrders.length > 0 ? activeSubOrders : order.subOrders;
    const allDelivered = relevantSubOrders.every(
      (so: any) => so.fulfillmentStatus === 'DELIVERED',
    );

    if (!allDelivered) {
      throw new BadRequestAppException(
        'Cannot mark as paid — all active sub-orders must be DELIVERED first',
      );
    }

    if (order.paymentStatus === 'PAID') {
      throw new BadRequestAppException('Order is already marked as paid');
    }

    if (order.paymentStatus === 'CANCELLED') {
      throw new BadRequestAppException(
        'Cannot mark a cancelled order as paid',
      );
    }

    // FSM enforcement — pinning the rule that VOIDED → PAID and other
    // illegal transitions are also rejected.
    assertTransition('OrderPaymentStatus', order.paymentStatus, 'PAID');

    await this.orderRepo.executeTransaction(async (tx) => {
      await tx.masterOrder.update({
        where: { id },
        data: { paymentStatus: 'PAID', orderStatus: 'DELIVERED' },
      });
      for (const so of relevantSubOrders) {
        await tx.subOrder.update({
          where: { id: so.id },
          data: { paymentStatus: 'PAID' },
        });
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Admin reassignment methods (Epic 2)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Get eligible sellers for a sub-order's items, ranked by allocation score.
   * Excludes the current seller.
   */
  async getEligibleSellers(subOrderId: string) {
    const subOrder =
      await this.orderRepo.findSubOrderByIdWithItems(subOrderId);
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');

    const addressSnapshot =
      subOrder.masterOrder.shippingAddressSnapshot as any;
    const customerPincode = addressSnapshot?.postalCode;
    if (!customerPincode) {
      throw new BadRequestAppException(
        'Cannot determine customer pincode from shipping address',
      );
    }

    // Find ALL sellers who have already rejected or been assigned this order
    const allSubOrders = await this.orderRepo.findSubOrdersByMasterOrder(
      subOrder.masterOrder.id,
    );
    const excludeSellerIds = new Set<string>();
    excludeSellerIds.add(subOrder.sellerId);
    for (const so of allSubOrders) {
      if (so.acceptStatus === 'REJECTED') {
        excludeSellerIds.add(so.sellerId);
      }
    }

    // Get mapping IDs to exclude
    const excludeMappingIds: string[] = [];
    for (const item of subOrder.items) {
      const ids = await this.orderRepo.findSellerProductMappingIds(
        item.productId,
        item.variantId,
        Array.from(excludeSellerIds),
      );
      excludeMappingIds.push(...ids);
    }

    // Collect eligible sellers across all items, intersecting eligibility
    const sellerScoresMap = new Map<
      string,
      {
        sellerId: string;
        sellerName: string;
        shopName: string;
        distanceKm: number;
        dispatchSla: number;
        availableStock: number;
        score: number;
      }
    >();

    for (const item of subOrder.items) {
      try {
        const allocation = await this.catalogFacade.allocate({
          productId: item.productId,
          variantId: item.variantId ?? undefined,
          customerPincode,
          quantity: item.quantity,
          excludeMappingIds,
        });

        if (allocation.allEligible) {
          for (const seller of allocation.allEligible) {
            if (excludeSellerIds.has(seller.sellerId)) continue;

            const existing = sellerScoresMap.get(seller.sellerId);
            if (!existing || seller.score > existing.score) {
              const sellerRecord = await this.orderRepo.findSeller(
                seller.sellerId,
              );

              sellerScoresMap.set(seller.sellerId, {
                sellerId: seller.sellerId,
                sellerName:
                  sellerRecord?.sellerName || seller.sellerName,
                shopName:
                  sellerRecord?.sellerShopName || seller.sellerName,
                distanceKm: seller.distanceKm,
                dispatchSla: seller.dispatchSla,
                availableStock: seller.availableStock,
                score: seller.score,
              });
            }
          }
        }
      } catch {
        // If allocation throws for an item, continue
      }
    }

    // Sort by score descending — NOTE: this still ONLY contains sellers.
    // The node-agnostic equivalent is `getEligibleNodes`. We keep this method
    // for backward-compat with existing callers that only want sellers.
    const sellers = Array.from(sellerScoresMap.values()).sort(
      (a, b) => b.score - a.score,
    );
    return sellers;
  }

  /**
   * Node-agnostic version of getEligibleSellers — returns both sellers AND
   * franchises that can fulfill this sub-order, ranked by allocation score.
   * Each entry carries a `nodeType` discriminator plus the corresponding ID.
   */
  async getEligibleNodes(subOrderId: string) {
    const subOrder =
      await this.orderRepo.findSubOrderByIdWithItems(subOrderId);
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');

    const addressSnapshot =
      subOrder.masterOrder.shippingAddressSnapshot as any;
    const customerPincode = addressSnapshot?.postalCode;
    if (!customerPincode) {
      throw new BadRequestAppException(
        'Cannot determine customer pincode from shipping address',
      );
    }

    // Exclude the currently-assigned node and anyone who already rejected
    // this master order — so the admin doesn't see the same rejector again.
    const allSubOrders = await this.orderRepo.findSubOrdersByMasterOrder(
      subOrder.masterOrder.id,
    );
    const excludeSellerIds = new Set<string>();
    const excludeFranchiseIds = new Set<string>();
    if (subOrder.sellerId) excludeSellerIds.add(subOrder.sellerId);
    if ((subOrder as any).franchiseId)
      excludeFranchiseIds.add((subOrder as any).franchiseId);
    for (const so of allSubOrders) {
      if (so.acceptStatus === 'REJECTED') {
        if (so.sellerId) excludeSellerIds.add(so.sellerId);
        if ((so as any).franchiseId)
          excludeFranchiseIds.add((so as any).franchiseId);
      }
    }

    // Intersect eligibility across items — a candidate only qualifies if
    // they can fulfill every line.
    type NodeCandidate = {
      nodeType: 'SELLER' | 'FRANCHISE';
      nodeId: string;
      name: string;
      distanceKm: number;
      dispatchSla: number;
      availableStock: number;
      score: number;
    };
    const scoreMap = new Map<string, NodeCandidate>();

    for (const item of subOrder.items) {
      try {
        const allocation = await this.catalogFacade.allocate({
          productId: item.productId,
          variantId: item.variantId ?? undefined,
          customerPincode,
          quantity: item.quantity,
        });

        if (allocation.allEligible) {
          for (const node of allocation.allEligible) {
            const isFranchise = node.nodeType === 'FRANCHISE';
            const nodeId = isFranchise
              ? node.franchiseId ?? node.sellerId
              : node.sellerId;

            if (!isFranchise && excludeSellerIds.has(nodeId)) continue;
            if (isFranchise && excludeFranchiseIds.has(nodeId)) continue;

            const key = `${node.nodeType}:${nodeId}`;
            const existing = scoreMap.get(key);
            if (!existing || node.score > existing.score) {
              scoreMap.set(key, {
                nodeType: node.nodeType,
                nodeId,
                name: node.sellerName,
                distanceKm: node.distanceKm,
                dispatchSla: node.dispatchSla,
                availableStock: node.availableStock,
                score: node.score,
              });
            }
          }
        }
      } catch {
        // per-item allocation failure shouldn't kill the whole listing
      }
    }

    return Array.from(scoreMap.values()).sort((a, b) => b.score - a.score);
  }

  /**
   * Manually reassign a sub-order to a different node (seller OR franchise).
   *
   * Signature accepts either:
   *   - a legacy string sellerId (backward-compat with existing callers)
   *   - a typed target `{ nodeType: 'SELLER'|'FRANCHISE', nodeId }`
   *
   * The previous node may itself be a seller or a franchise — stock release
   * branches on the CURRENT assignment, reservation creation branches on the
   * NEW assignment. Cross-actor reassignment (SELLER↔FRANCHISE) is supported.
   */
  async reassignSubOrder(
    subOrderId: string,
    target: ReassignTarget | string,
    reason?: string,
  ) {
    if (!subOrderId)
      throw new BadRequestAppException('subOrderId is required');

    // Normalize legacy string form
    const newTarget: ReassignTarget =
      typeof target === 'string'
        ? { nodeType: 'SELLER', nodeId: target }
        : target;

    if (!newTarget?.nodeId)
      throw new BadRequestAppException('target nodeId is required');
    const rawNodeType = (newTarget as { nodeType: string }).nodeType;
    if (rawNodeType !== 'SELLER' && rawNodeType !== 'FRANCHISE') {
      throw new BadRequestAppException(
        `Invalid nodeType: ${rawNodeType}. Must be 'SELLER' or 'FRANCHISE'.`,
      );
    }

    // 1. Get the sub-order with items
    const subOrder =
      await this.orderRepo.findSubOrderByIdWithItems(subOrderId);
    if (!subOrder)
      throw new NotFoundAppException(`Sub-order ${subOrderId} not found`);

    const previousSellerId: string | null = subOrder.sellerId ?? null;
    const previousFranchiseId: string | null =
      (subOrder as any).franchiseId ?? null;
    const previousNodeType =
      (subOrder as any).fulfillmentNodeType ||
      (previousFranchiseId ? 'FRANCHISE' : 'SELLER');

    // Reject no-op reassignment (same node)
    if (
      newTarget.nodeType === 'SELLER' &&
      previousSellerId === newTarget.nodeId
    ) {
      throw new BadRequestAppException(
        'Sub-order is already assigned to this seller',
      );
    }
    if (
      newTarget.nodeType === 'FRANCHISE' &&
      previousFranchiseId === newTarget.nodeId
    ) {
      throw new BadRequestAppException(
        'Sub-order is already assigned to this franchise',
      );
    }

    if (
      subOrder.acceptStatus !== 'OPEN' &&
      subOrder.acceptStatus !== 'REJECTED'
    ) {
      throw new BadRequestAppException(
        `Cannot reassign sub-order with accept status ${subOrder.acceptStatus}. Only OPEN or REJECTED sub-orders can be reassigned.`,
      );
    }

    // 2. Validate new node exists, is ACTIVE, has mapping + stock for every item
    if (newTarget.nodeType === 'SELLER') {
      const newSeller = await this.orderRepo.findSeller(newTarget.nodeId);
      if (!newSeller)
        throw new NotFoundAppException(`Seller ${newTarget.nodeId} not found`);
      if (newSeller.status !== 'ACTIVE') {
        throw new BadRequestAppException(
          `Seller ${newTarget.nodeId} is not active (status: ${newSeller.status})`,
        );
      }
      for (const item of subOrder.items) {
        const mapping = await this.orderRepo.findSellerProductMapping(
          newTarget.nodeId,
          item.productId,
          item.variantId,
        );
        if (!mapping) {
          throw new BadRequestAppException(
            `Seller ${newTarget.nodeId} does not have an active mapping for product ${item.productId}${item.variantId ? ` / variant ${item.variantId}` : ''}`,
          );
        }
        const available = mapping.stockQty - mapping.reservedQty;
        if (available < item.quantity) {
          throw new BadRequestAppException(
            `Seller ${newTarget.nodeId} has insufficient stock for product ${item.productId}: available=${available}, required=${item.quantity}`,
          );
        }
      }
    } else {
      // FRANCHISE target
      const franchise = await this.prisma.franchisePartner.findUnique({
        where: { id: newTarget.nodeId },
        select: { id: true, status: true, businessName: true, isDeleted: true },
      });
      if (!franchise || franchise.isDeleted) {
        throw new NotFoundAppException(
          `Franchise ${newTarget.nodeId} not found`,
        );
      }
      if (franchise.status !== 'ACTIVE') {
        throw new BadRequestAppException(
          `Franchise ${newTarget.nodeId} is not active (status: ${franchise.status})`,
        );
      }
      for (const item of subOrder.items) {
        const mapping = await this.prisma.franchiseCatalogMapping.findFirst({
          where: {
            franchiseId: newTarget.nodeId,
            productId: item.productId,
            variantId: item.variantId ?? null,
            isActive: true,
            approvalStatus: 'APPROVED',
          },
          select: { id: true },
        });
        if (!mapping) {
          throw new BadRequestAppException(
            `Franchise ${newTarget.nodeId} does not have an approved mapping for product ${item.productId}${item.variantId ? ` / variant ${item.variantId}` : ''}`,
          );
        }
        const stock = await this.prisma.franchiseStock.findFirst({
          where: {
            franchiseId: newTarget.nodeId,
            productId: item.productId,
            variantId: item.variantId ?? null,
          },
          select: { availableQty: true },
        });
        if (!stock || stock.availableQty < item.quantity) {
          throw new BadRequestAppException(
            `Franchise ${newTarget.nodeId} has insufficient stock for product ${item.productId}: available=${stock?.availableQty ?? 0}, required=${item.quantity}`,
          );
        }
      }
    }

    const now = new Date();
    const acceptDeadlineAt = new Date(now.getTime() + ACCEPT_DEADLINE_MS);

    // 3. Release previous node's hold (branches on previous node type).
    //    We do this OUTSIDE the transaction for the FRANCHISE case because
    //    the franchise facade manages its own persistence path (ledger +
    //    stock update) that isn't expressible as a single tx with our repo.
    //    Rollback on subsequent failure is mitigated by validation above.
    if (previousNodeType === 'SELLER' && previousSellerId) {
      await this.orderRepo.executeTransaction(async (tx) => {
        const currentReservations = await tx.stockReservation.findMany({
          where: {
            orderId: subOrder.masterOrder.id,
            status: { in: ['RESERVED', 'CONFIRMED'] },
            mapping: { sellerId: previousSellerId },
          },
        });
        for (const res of currentReservations) {
          if (res.status === 'CONFIRMED') {
            await tx.stockReservation.update({
              where: { id: res.id },
              data: { status: 'RELEASED' },
            });
            await tx.sellerProductMapping.update({
              where: { id: res.mappingId },
              data: { stockQty: { increment: res.quantity } },
            });
          } else {
            await tx.stockReservation.update({
              where: { id: res.id },
              data: { status: 'RELEASED' },
            });
            await tx.sellerProductMapping.update({
              where: { id: res.mappingId },
              data: { reservedQty: { decrement: res.quantity } },
            });
          }
        }
      });
    } else if (previousNodeType === 'FRANCHISE' && previousFranchiseId) {
      for (const item of subOrder.items) {
        await this.franchiseFacade
          .unreserveStock(
            previousFranchiseId,
            item.productId,
            item.variantId ?? null,
            item.quantity,
            subOrder.masterOrder.id,
          )
          .catch(() => {
            // Best effort — old hold may already have been released if the
            // sub-order was REJECTED and auto-rebooked earlier.
          });
      }
    }

    // 4. Reserve stock on the new node.
    if (newTarget.nodeType === 'SELLER') {
      await this.orderRepo.executeTransaction(async (tx) => {
        for (const item of subOrder.items) {
          const newMapping = await tx.sellerProductMapping.findFirst({
            where: {
              sellerId: newTarget.nodeId,
              productId: item.productId,
              variantId: item.variantId,
              isActive: true,
            },
          });
          if (newMapping) {
            await tx.stockReservation.create({
              data: {
                mappingId: newMapping.id,
                quantity: item.quantity,
                status: 'CONFIRMED',
                orderId: subOrder.masterOrder.id,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              },
            });
            await tx.sellerProductMapping.update({
              where: { id: newMapping.id },
              data: { reservedQty: { increment: item.quantity } },
            });
          }
        }
      });
    } else {
      for (const item of subOrder.items) {
        await this.franchiseFacade.reserveStock(
          newTarget.nodeId,
          item.productId,
          item.variantId ?? null,
          item.quantity,
          subOrder.masterOrder.id,
        );
      }
    }

    // 5. Update the sub-order row + promote master out of EXCEPTION_QUEUE
    await this.orderRepo.executeTransaction(async (tx) => {
      await tx.subOrder.update({
        where: { id: subOrderId },
        data: {
          // Swap node fields: set new, clear the other side
          sellerId: newTarget.nodeType === 'SELLER' ? newTarget.nodeId : null,
          franchiseId:
            newTarget.nodeType === 'FRANCHISE' ? newTarget.nodeId : null,
          fulfillmentNodeType: newTarget.nodeType,
          acceptStatus: 'OPEN',
          fulfillmentStatus: 'UNFULFILLED',
          acceptDeadlineAt,
        } as any,
      });

      if (subOrder.masterOrder.orderStatus === 'EXCEPTION_QUEUE') {
        await tx.masterOrder.update({
          where: { id: subOrder.masterOrder.id },
          data: { orderStatus: 'ROUTED_TO_SELLER' },
        });
      }

      for (const item of subOrder.items) {
        await tx.allocationLog.create({
          data: {
            productId: item.productId,
            variantId: item.variantId,
            customerPincode: 'ADMIN_REASSIGN',
            allocatedNodeType: newTarget.nodeType,
            allocatedSellerId:
              newTarget.nodeType === 'SELLER' ? newTarget.nodeId : null,
            allocatedFranchiseId:
              newTarget.nodeType === 'FRANCHISE' ? newTarget.nodeId : null,
            allocationReason: `Admin manual reassignment: from ${previousNodeType.toLowerCase()} ${previousSellerId ?? previousFranchiseId} to ${newTarget.nodeType.toLowerCase()} ${newTarget.nodeId}${reason ? ` — ${reason}` : ''}`,
            isReallocated: true,
            orderId: subOrder.masterOrder.id,
          } as any,
        });
      }
    });

    // 6. Log in OrderReassignmentLog (outside transaction — best effort).
    //    `fromSellerId`/`toSellerId` are retained for backward-compat; when
    //    either side is a franchise we use the franchise id in the same slot
    //    so the log remains readable.
    await this.orderRepo
      .createReassignmentLog({
        subOrderId,
        masterOrderId: subOrder.masterOrder.id,
        fromSellerId: previousSellerId ?? previousFranchiseId ?? '',
        toSellerId: newTarget.nodeId,
        reason:
          reason ||
          `Admin manual reassignment (${previousNodeType} → ${newTarget.nodeType})`,
        successful: true,
        newSubOrderId: null,
      })
      .catch(() => {});

    // 7. Publish event
    await this.eventBus
      .publish({
        eventName: 'orders.sub_order.reassigned',
        aggregate: 'SubOrder',
        aggregateId: subOrderId,
        occurredAt: now,
        payload: {
          subOrderId,
          masterOrderId: subOrder.masterOrder.id,
          orderNumber: subOrder.masterOrder.orderNumber,
          fromNodeType: previousNodeType,
          fromNodeId: previousSellerId ?? previousFranchiseId,
          toNodeType: newTarget.nodeType,
          toNodeId: newTarget.nodeId,
          // Legacy fields kept for existing consumers
          fromSellerId: previousSellerId,
          toSellerId:
            newTarget.nodeType === 'SELLER' ? newTarget.nodeId : null,
          reason: reason || 'Admin manual reassignment',
        },
      })
      .catch(() => {});

    const updated =
      await this.orderRepo.findSubOrderByIdWithItems(subOrderId);
    return updated;
  }

  /**
   * Get reassignment history for a master order.
   */
  async getReassignmentHistory(masterOrderId: string) {
    return this.orderRepo.findReassignmentLogs(masterOrderId);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Seller-scoped methods
  // ────────────────────────────────────────────────────────────────────────

  async listSellerOrders(
    sellerId: string,
    page: number,
    limit: number,
    filters?: {
      fulfillmentStatus?: string;
      acceptStatus?: string;
      paymentStatus?: string;
      search?: string;
    },
  ) {
    // Sellers should only see orders that have been verified and routed (or beyond)
    const routedOrLaterStatuses = [
      'ROUTED_TO_SELLER',
      'SELLER_ACCEPTED',
      'DISPATCHED',
      'DELIVERED',
    ] as const;

    const where: Prisma.SubOrderWhereInput = {
      sellerId,
      masterOrder: {
        orderStatus: { in: [...routedOrLaterStatuses] },
      },
    };

    if (filters?.fulfillmentStatus) {
      where.fulfillmentStatus = filters.fulfillmentStatus as any;
    }
    if (filters?.acceptStatus) {
      where.acceptStatus = filters.acceptStatus as any;
    }
    if (filters?.paymentStatus) {
      where.paymentStatus = filters.paymentStatus as any;
    }
    if (filters?.search) {
      where.masterOrder = {
        ...((where.masterOrder as any) || {}),
        orderNumber: {
          contains: filters.search,
          mode: 'insensitive',
        },
      };
    }

    const [subOrders, total] = await Promise.all([
      this.orderRepo.findSellerSubOrders(
        where,
        (page - 1) * limit,
        limit,
      ),
      this.orderRepo.countSellerSubOrders(where),
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

  async getSellerOrder(id: string, sellerId: string) {
    const subOrder = await this.orderRepo.findSubOrderForSeller(
      id,
      sellerId,
    );
    if (!subOrder) throw new NotFoundAppException('Order not found');
    return subOrder;
  }

  async sellerAcceptOrder(
    id: string,
    sellerId: string,
    options?: { expectedDispatchDate?: string },
  ) {
    const subOrder = await this.orderRepo.findSubOrderForSellerBasic(
      id,
      sellerId,
    );
    if (!subOrder) throw new NotFoundAppException('Order not found');
    if (subOrder.acceptStatus !== 'OPEN') {
      throw new BadRequestAppException(
        `Order is already ${subOrder.acceptStatus}`,
      );
    }
    const updateData: any = { acceptStatus: 'ACCEPTED' };
    if (options?.expectedDispatchDate) {
      updateData.expectedDispatchDate = new Date(
        options.expectedDispatchDate,
      );
    }
    const updated = await this.orderRepo.updateSubOrder(id, updateData);

    // Update master order status to SELLER_ACCEPTED
    await this.orderRepo.updateMasterOrder(subOrder.masterOrderId, {
      orderStatus: 'SELLER_ACCEPTED',
    });

    return updated;
  }

  // T5: Seller reject with reassignment logic
  async sellerRejectOrder(
    id: string,
    sellerId: string,
    options?: { reason?: string; note?: string },
  ) {
    const subOrder =
      await this.orderRepo.findSubOrderForSellerWithDetails(
        id,
        sellerId,
      );
    if (!subOrder) throw new NotFoundAppException('Order not found');
    if (subOrder.acceptStatus !== 'OPEN') {
      throw new BadRequestAppException(
        `Order is already ${subOrder.acceptStatus}`,
      );
    }

    // Mark current sub-order as rejected
    await this.orderRepo.updateSubOrder(id, {
      acceptStatus: 'REJECTED',
      fulfillmentStatus: 'CANCELLED',
      rejectionReason: options?.reason || null,
      rejectionNote: options?.note || null,
    });

    // Restore stock for the rejected seller's confirmed reservations
    const rejectedReservations =
      await this.orderRepo.findStockReservations(
        subOrder.masterOrder.id,
        sellerId,
      );

    for (const res of rejectedReservations) {
      if (res.status === 'CONFIRMED') {
        await this.orderRepo.restoreStockFromConfirmedReservation(
          res.id,
          res.mappingId,
          res.quantity,
        );
      } else if (res.status === 'RESERVED') {
        await this.orderRepo.releaseReservedStock(
          res.id,
          res.mappingId,
          res.quantity,
        );
      }
    }

    // T5: Attempt reassignment for each item
    const addressSnapshot =
      subOrder.masterOrder.shippingAddressSnapshot as any;
    const customerPincode = addressSnapshot?.postalCode;

    let reassignmentSuccessful = false;
    let newSubOrderId: string | null = null;
    let newSellerId: string | null = null;

    if (customerPincode) {
      try {
        // Find ALL sellers who have already rejected this master order
        const previousRejections =
          await this.orderRepo.findSubOrdersByMasterOrder(
            subOrder.masterOrder.id,
          );
        const rejectedSellerIds = new Set(
          previousRejections
            .filter((r: any) => r.acceptStatus === 'REJECTED')
            .map((r: any) => r.sellerId),
        );
        rejectedSellerIds.add(sellerId);

        // Find all mapping IDs belonging to rejected sellers for this product
        const rejectedMappingIds: string[] = [];
        for (const item of subOrder.items) {
          const ids =
            await this.orderRepo.findSellerProductMappingIds(
              item.productId,
              item.variantId,
              Array.from(rejectedSellerIds),
            );
          rejectedMappingIds.push(...ids);
        }

        // Group items by productId/variantId for reallocation
        for (const item of subOrder.items) {
          const reallocation = await this.catalogFacade.allocate({
            productId: item.productId,
            variantId: item.variantId ?? undefined,
            customerPincode,
            quantity: item.quantity,
            excludeMappingIds: rejectedMappingIds,
          });

          if (
            reallocation.serviceable &&
            reallocation.primary
          ) {
            // Reserve stock for new seller
            const reservation =
              await this.catalogFacade.reserveStock({
                mappingId: reallocation.primary.mappingId,
                quantity: item.quantity,
                orderId: subOrder.masterOrder.id,
                expiresInMinutes: 60,
              });

            // Confirm reservation immediately since order already exists
            await this.catalogFacade.confirmReservation(
              reservation.id,
              subOrder.masterOrder.id,
            );

            // Create new sub-order for the new seller
            const acceptDeadlineAt = new Date(
              Date.now() + ACCEPT_DEADLINE_MS,
            );
            const newSubOrder =
              await this.orderRepo.createSubOrder({
                masterOrderId: subOrder.masterOrder.id,
                sellerId: reallocation.primary.sellerId,
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
                    masterSku:
                      (item as any).masterSku || item.sku,
                    imageUrl: item.imageUrl,
                    unitPrice: item.unitPrice,
                    quantity: item.quantity,
                    totalPrice: item.totalPrice,
                  },
                },
              });

            reassignmentSuccessful = true;
            newSubOrderId = newSubOrder.id;
            newSellerId = reallocation.primary.sellerId;

            // Publish event for new seller notification
            await this.eventBus.publish({
              eventName: 'orders.sub_order.created',
              aggregate: 'SubOrder',
              aggregateId: newSubOrder.id,
              occurredAt: new Date(),
              payload: {
                subOrderId: newSubOrder.id,
                masterOrderId: subOrder.masterOrder.id,
                orderNumber: subOrder.masterOrder.orderNumber,
                sellerId: reallocation.primary.sellerId,
                sellerName: reallocation.primary.sellerName,
                subTotal: Number(item.totalPrice),
                itemCount: item.quantity,
                isReassignment: true,
              },
            });
          }
        }
      } catch {
        // Reassignment failed — continue with cancellation below
      }
    }

    // If no reassignment was possible, move master order to EXCEPTION_QUEUE
    if (!reassignmentSuccessful) {
      await this.orderRepo.updateMasterOrder(subOrder.masterOrder.id, {
        orderStatus: 'EXCEPTION_QUEUE',
      });

      // Publish exception event for admin notification
      await this.eventBus.publish({
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
            'Seller rejected and no alternative seller available — awaiting manual reassignment',
          rejectedSubOrderId: id,
          rejectedSellerId: sellerId,
        },
      });
    }

    // Log the reassignment attempt
    await this.orderRepo
      .createReassignmentLog({
        subOrderId: id,
        masterOrderId: subOrder.masterOrder.id,
        fromSellerId: sellerId,
        toSellerId: newSellerId,
        reason: 'Seller rejected the order',
        successful: reassignmentSuccessful,
        newSubOrderId,
      })
      .catch(() => {});

    return {
      rejected: true,
      reassigned: reassignmentSuccessful,
      newSubOrderId,
      message: reassignmentSuccessful
        ? 'Order rejected and reassigned to another seller'
        : 'Order rejected — no alternative seller available, moved to exception queue for manual reassignment',
    };
  }

  // T4: Update fulfillment status (PACKED, SHIPPED, etc.)
  async sellerUpdateFulfillmentStatus(
    id: string,
    sellerId: string,
    status: string,
    extra?: { trackingNumber?: string; courierName?: string },
  ) {
    const subOrder = await this.orderRepo.findSubOrderForSellerBasic(
      id,
      sellerId,
    );
    if (!subOrder) throw new NotFoundAppException('Order not found');
    if (subOrder.acceptStatus !== 'ACCEPTED') {
      throw new BadRequestAppException(
        'Order must be accepted before updating fulfillment status',
      );
    }

    // Seller can only move: UNFULFILLED -> PACKED -> SHIPPED
    // DELIVERED must be confirmed by admin (or by Shiprocket webhook)
    const sellerAllowedTransitions: Record<string, string[]> = {
      UNFULFILLED: ['PACKED'],
      PACKED: ['SHIPPED'],
    };

    const allowed =
      sellerAllowedTransitions[subOrder.fulfillmentStatus] || [];
    if (!allowed.includes(status)) {
      if (status === 'DELIVERED') {
        throw new BadRequestAppException(
          'Delivery must be confirmed by admin. Seller can only update status up to SHIPPED.',
        );
      }
      if (status === 'FULFILLED') {
        throw new BadRequestAppException(
          'FULFILLED status is deprecated. Use PACKED -> SHIPPED flow instead.',
        );
      }
      throw new BadRequestAppException(
        `Cannot transition from ${subOrder.fulfillmentStatus} to ${status}. Allowed: ${allowed.join(', ') || 'none (seller flow complete)'}`,
      );
    }

    // Defense-in-depth: also validate against the global FSM in case the
    // ad-hoc check above ever drifts.
    assertTransition('OrderFulfillmentStatus', subOrder.fulfillmentStatus, status);

    // When moving to SHIPPED, tracking number and courier name are required
    if (status === 'SHIPPED') {
      const trackingNumber = extra?.trackingNumber?.trim();
      const courierName = extra?.courierName?.trim();
      if (!trackingNumber || !courierName) {
        throw new BadRequestAppException(
          'trackingNumber and courierName are required when marking an order as SHIPPED',
        );
      }
    }

    const updateData: any = { fulfillmentStatus: status };
    if (status === 'SHIPPED') {
      updateData.trackingNumber = extra?.trackingNumber?.trim();
      updateData.courierName = extra?.courierName?.trim();
    }
    const updated = await this.orderRepo.updateSubOrder(
      id,
      updateData,
    );

    // Update master order status to reflect fulfillment progress
    if (status === 'SHIPPED') {
      await this.orderRepo.updateMasterOrder(subOrder.masterOrderId, {
        orderStatus: 'DISPATCHED',
      });
    }

    // Publish fulfillment status change event
    await this.eventBus
      .publish({
        eventName: 'orders.sub_order.status_changed',
        aggregate: 'SubOrder',
        aggregateId: id,
        occurredAt: new Date(),
        payload: {
          subOrderId: id,
          sellerId,
          previousStatus: subOrder.fulfillmentStatus,
          newStatus: status,
        },
      })
      .catch(() => {});

    return updated;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Customer-scoped methods
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Map an OrderStatus enum value to a customer-friendly label.
   */
  private mapOrderStatusLabel(status: string): string {
    return ORDER_STATUS_LABELS[status] || status;
  }

  async listCustomerOrders(
    customerId: string,
    page: number,
    limit: number,
  ) {
    const [orders, total] = await Promise.all([
      this.orderRepo.findCustomerOrders(
        customerId,
        (page - 1) * limit,
        limit,
      ),
      this.orderRepo.countCustomerOrders(customerId),
    ]);

    // Strip seller information — customers should not see seller names
    // Add customer-friendly status labels
    const sanitized = orders.map((o: any) => ({
      ...o,
      orderStatusLabel: this.mapOrderStatusLabel(o.orderStatus),
      subOrders: o.subOrders.map((so: any) => ({
        id: so.id,
        subTotal: so.subTotal,
        paymentStatus: so.paymentStatus,
        fulfillmentStatus: so.fulfillmentStatus,
        acceptStatus: so.acceptStatus,
        deliveredAt: so.deliveredAt,
        items: so.items,
      })),
    }));

    return {
      orders: sanitized,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getCustomerOrder(customerId: string, orderNumber: string) {
    const order = await this.orderRepo.findMasterOrderByCustomer(
      orderNumber,
      customerId,
    );

    if (!order) throw new NotFoundAppException('Order not found');

    // Strip seller information — show "Fulfilled by SPORTSMART" label
    // Add customer-friendly status label
    return {
      ...order,
      orderStatusLabel: this.mapOrderStatusLabel(order.orderStatus),
      subOrders: order.subOrders.map((so: any) => ({
        id: so.id,
        subTotal: so.subTotal,
        paymentStatus: so.paymentStatus,
        fulfillmentStatus: so.fulfillmentStatus,
        acceptStatus: so.acceptStatus,
        deliveredAt: so.deliveredAt,
        returnWindowEndsAt: so.returnWindowEndsAt,
        fulfilledBy: 'SPORTSMART',
        items: so.items,
      })),
    };
  }
}
