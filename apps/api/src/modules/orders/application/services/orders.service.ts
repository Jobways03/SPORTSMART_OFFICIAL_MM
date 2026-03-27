import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { BadRequestAppException, NotFoundAppException } from '../../../../core/exceptions';
import { Prisma } from '@prisma/client';
import {
  SellerAllocationService,
} from '../../../catalog/application/services/seller-allocation.service';

const RETURN_WINDOW_MS = 60 * 1000; // 1 minute for testing
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
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly allocationService: SellerAllocationService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────
  // Admin methods
  // ────────────────────────────────────────────────────────────────────────

  async listOrders(filters: {
    page: number; limit: number;
    paymentStatus?: string; fulfillmentStatus?: string;
    acceptStatus?: string; orderStatus?: string; search?: string;
  }) {
    const { page, limit, paymentStatus, fulfillmentStatus, acceptStatus, orderStatus, search } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.MasterOrderWhereInput = {};
    if (paymentStatus) where.paymentStatus = paymentStatus as any;
    if (orderStatus) where.orderStatus = orderStatus as any;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customer: { OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ] } },
      ];
    }

    const subOrderFilter: Prisma.SubOrderWhereInput = {};
    if (fulfillmentStatus) subOrderFilter.fulfillmentStatus = fulfillmentStatus as any;
    if (acceptStatus) subOrderFilter.acceptStatus = acceptStatus as any;
    if (Object.keys(subOrderFilter).length > 0) where.subOrders = { some: subOrderFilter };

    const [orders, total] = await Promise.all([
      this.prisma.masterOrder.findMany({
        where,
        include: {
          customer: { select: { firstName: true, lastName: true, email: true } },
          subOrders: { include: { items: true, seller: { select: { id: true, sellerName: true, sellerShopName: true, email: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.masterOrder.count({ where }),
    ]);

    return { orders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getOrder(id: string) {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id },
      include: {
        customer: { select: { firstName: true, lastName: true, email: true, phone: true } },
        subOrders: {
          include: {
            items: true,
            commissionRecords: true,
            seller: { select: { id: true, sellerName: true, sellerShopName: true, email: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundAppException('Order not found');

    // Include reassignment history
    const reassignmentLogs = await this.prisma.orderReassignmentLog.findMany({
      where: { masterOrderId: id },
      orderBy: { createdAt: 'desc' },
    });

    // Enrich logs with seller names
    const enrichedLogs = await Promise.all(
      reassignmentLogs.map(async (log) => {
        const [fromSeller, toSeller] = await Promise.all([
          this.prisma.seller.findUnique({
            where: { id: log.fromSellerId },
            select: { sellerName: true, sellerShopName: true },
          }),
          log.toSellerId
            ? this.prisma.seller.findUnique({
                where: { id: log.toSellerId },
                select: { sellerName: true, sellerShopName: true },
              })
            : null,
        ]);
        return {
          ...log,
          fromSellerName: fromSeller?.sellerShopName || fromSeller?.sellerName || log.fromSellerId,
          toSellerName: toSeller?.sellerShopName || toSeller?.sellerName || log.toSellerId || 'N/A',
        };
      }),
    );

    return { ...order, reassignmentLogs: enrichedLogs };
  }

  /**
   * Verify an order: validate, set status to VERIFIED, then attempt allocation.
   * If all items are serviceable, confirm reservations and route to sellers.
   * If some items are unserviceable, move to EXCEPTION_QUEUE.
   */
  async verifyOrder(id: string, adminId: string, remarks?: string) {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id },
      include: {
        subOrders: {
          include: { items: true },
        },
      },
    });
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
    await this.prisma.masterOrder.update({
      where: { id },
      data: {
        orderStatus: 'VERIFIED',
        verified: true,
        verifiedAt: now,
        verifiedBy: adminId,
        verificationRemarks: remarks || null,
      },
    });

    // Step 2: Attempt allocation for each sub-order's items
    const addressSnapshot = order.shippingAddressSnapshot as any;
    const customerPincode = addressSnapshot?.postalCode;

    if (!customerPincode) {
      // No pincode available — cannot route, move to exception queue
      await this.prisma.masterOrder.update({
        where: { id },
        data: { orderStatus: 'EXCEPTION_QUEUE' },
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
          const allocation = await this.allocationService.allocate({
            productId: item.productId,
            variantId: item.variantId ?? undefined,
            customerPincode,
            quantity: item.quantity,
          });

          if (!allocation.serviceable || !allocation.primary) {
            subOrderServiceable = false;
            break;
          }

          // If the allocated seller differs from the original sub-order seller,
          // that is okay for the simpler approach — the checkout already assigned sellers.
          // We just validate serviceability here.
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
      await this.prisma.subOrder.update({
        where: { id: subOrder.id },
        data: { acceptDeadlineAt },
      });
    }

    // Step 3: Set final order status based on routing results
    if (allRoutedSuccessfully) {
      await this.prisma.masterOrder.update({
        where: { id },
        data: { orderStatus: 'ROUTED_TO_SELLER' },
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
      await this.prisma.masterOrder.update({
        where: { id },
        data: { orderStatus: 'EXCEPTION_QUEUE' },
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
    const order = await this.prisma.masterOrder.findUnique({
      where: { id },
      include: { subOrders: { include: { items: true } } },
    });
    if (!order) throw new NotFoundAppException('Order not found');
    if (order.orderStatus === 'ROUTED_TO_SELLER' || order.orderStatus === 'SELLER_ACCEPTED' || order.orderStatus === 'DISPATCHED' || order.orderStatus === 'DELIVERED') {
      throw new BadRequestAppException('Cannot reject an order that has already been routed or fulfilled');
    }
    if (order.paymentStatus === 'CANCELLED') throw new BadRequestAppException('Order is already cancelled');

    await this.prisma.$transaction(async (tx) => {
      await tx.masterOrder.update({
        where: { id },
        data: { paymentStatus: 'CANCELLED', orderStatus: 'CANCELLED' },
      });

      for (const so of order.subOrders) {
        await tx.subOrder.update({
          where: { id: so.id },
          data: { paymentStatus: 'CANCELLED', acceptStatus: 'REJECTED', commissionProcessed: true },
        });

        for (const item of so.items) {
          if (item.variantId) {
            await tx.productVariant.update({ where: { id: item.variantId }, data: { stock: { increment: item.quantity } } });
          } else {
            await tx.product.update({ where: { id: item.productId }, data: { baseStock: { increment: item.quantity } } });
          }
        }
      }
    });
  }

  async acceptSubOrder(id: string) {
    const subOrder = await this.prisma.subOrder.findUnique({ where: { id } });
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');
    return this.prisma.subOrder.update({ where: { id }, data: { acceptStatus: 'ACCEPTED' } });
  }

  async rejectSubOrder(id: string) {
    const subOrder = await this.prisma.subOrder.findUnique({ where: { id } });
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');
    return this.prisma.subOrder.update({ where: { id }, data: { acceptStatus: 'REJECTED' } });
  }

  async fulfillSubOrder(id: string) {
    const subOrder = await this.prisma.subOrder.findUnique({ where: { id } });
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');
    return this.prisma.subOrder.update({ where: { id }, data: { fulfillmentStatus: 'FULFILLED' } });
  }

  async deliverSubOrder(id: string) {
    const subOrder = await this.prisma.subOrder.findUnique({
      where: { id },
      include: { masterOrder: { include: { subOrders: true } } },
    });
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');

    if (subOrder.fulfillmentStatus !== 'SHIPPED') {
      throw new BadRequestAppException(
        `Cannot mark as delivered — sub-order fulfillment status is ${subOrder.fulfillmentStatus}, expected SHIPPED`,
      );
    }

    const now = new Date();
    const updated = await this.prisma.subOrder.update({
      where: { id },
      data: { fulfillmentStatus: 'DELIVERED', deliveredAt: now, returnWindowEndsAt: new Date(now.getTime() + RETURN_WINDOW_MS) },
    });

    // Check if ALL active (non-rejected) sub-orders are now DELIVERED
    const activeSubOrders = subOrder.masterOrder.subOrders.filter((so) => so.acceptStatus !== 'REJECTED');
    const allDelivered = activeSubOrders.every((so) =>
      so.id === id ? true : so.fulfillmentStatus === 'DELIVERED',
    );

    if (allDelivered) {
      await this.prisma.masterOrder.update({
        where: { id: subOrder.masterOrderId },
        data: { orderStatus: 'DELIVERED' },
      });
    }

    return updated;
  }

  async markAsPaid(id: string) {
    const order = await this.prisma.masterOrder.findUnique({ where: { id }, include: { subOrders: true } });
    if (!order) throw new NotFoundAppException('Order not found');

    // Only consider active (non-rejected) sub-orders
    const activeSubOrders = order.subOrders.filter((so) => so.acceptStatus !== 'REJECTED');
    const relevantSubOrders = activeSubOrders.length > 0 ? activeSubOrders : order.subOrders;
    const allDelivered = relevantSubOrders.every((so) => so.fulfillmentStatus === 'DELIVERED');

    if (!allDelivered) {
      throw new BadRequestAppException(
        'Cannot mark as paid — all active sub-orders must be DELIVERED first',
      );
    }

    if (order.paymentStatus === 'PAID') {
      throw new BadRequestAppException('Order is already marked as paid');
    }

    if (order.paymentStatus === 'CANCELLED') {
      throw new BadRequestAppException('Cannot mark a cancelled order as paid');
    }

    await this.prisma.$transaction([
      this.prisma.masterOrder.update({ where: { id }, data: { paymentStatus: 'PAID', orderStatus: 'DELIVERED' } }),
      ...relevantSubOrders.map((so) => this.prisma.subOrder.update({ where: { id: so.id }, data: { paymentStatus: 'PAID' } })),
    ]);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Admin reassignment methods (Epic 2)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Get eligible sellers for a sub-order's items, ranked by allocation score.
   * Excludes the current seller.
   */
  async getEligibleSellers(subOrderId: string) {
    const subOrder = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      include: {
        items: true,
        masterOrder: {
          select: { id: true, shippingAddressSnapshot: true },
        },
      },
    });
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');

    const addressSnapshot = subOrder.masterOrder.shippingAddressSnapshot as any;
    const customerPincode = addressSnapshot?.postalCode;
    if (!customerPincode) {
      throw new BadRequestAppException('Cannot determine customer pincode from shipping address');
    }

    // Find ALL sellers who have already rejected or been assigned this order
    const allSubOrders = await this.prisma.subOrder.findMany({
      where: { masterOrderId: subOrder.masterOrderId },
      select: { sellerId: true, acceptStatus: true },
    });
    const excludeSellerIds = new Set<string>();
    // Exclude the current seller on this sub-order
    excludeSellerIds.add(subOrder.sellerId);
    // Exclude all sellers who rejected any sub-order for this master order
    for (const so of allSubOrders) {
      if (so.acceptStatus === 'REJECTED') {
        excludeSellerIds.add(so.sellerId);
      }
    }

    // Get mapping IDs to exclude
    const excludeMappingIds: string[] = [];
    for (const item of subOrder.items) {
      const mappings = await this.prisma.sellerProductMapping.findMany({
        where: {
          productId: item.productId,
          variantId: item.variantId,
          sellerId: { in: Array.from(excludeSellerIds) },
        },
        select: { id: true },
      });
      excludeMappingIds.push(...mappings.map(m => m.id));
    }

    // Collect eligible sellers across all items, intersecting eligibility
    const sellerScoresMap = new Map<string, {
      sellerId: string;
      sellerName: string;
      shopName: string;
      distanceKm: number;
      dispatchSla: number;
      availableStock: number;
      score: number;
    }>();

    for (const item of subOrder.items) {
      try {
        const allocation = await this.allocationService.allocate({
          productId: item.productId,
          variantId: item.variantId ?? undefined,
          customerPincode,
          quantity: item.quantity,
          excludeMappingIds,
        });

        if (allocation.allEligible) {
          for (const seller of allocation.allEligible) {
            // Skip excluded sellers (double-check)
            if (excludeSellerIds.has(seller.sellerId)) continue;

            const existing = sellerScoresMap.get(seller.sellerId);
            if (!existing || seller.score > existing.score) {
              // Look up seller details
              const sellerRecord = await this.prisma.seller.findUnique({
                where: { id: seller.sellerId },
                select: { sellerName: true, sellerShopName: true },
              });

              sellerScoresMap.set(seller.sellerId, {
                sellerId: seller.sellerId,
                sellerName: sellerRecord?.sellerName || seller.sellerName,
                shopName: sellerRecord?.sellerShopName || seller.sellerName,
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

    // Sort by score descending
    const sellers = Array.from(sellerScoresMap.values()).sort((a, b) => b.score - a.score);
    return sellers;
  }

  /**
   * Manually reassign a sub-order to a different seller.
   * - Validates target seller has active mapping with stock
   * - Releases old seller's reservations
   * - Creates new reservation for target seller
   * - Updates sub-order's sellerId
   * - Sets acceptDeadlineAt = now + 24h
   * - Logs in OrderReassignmentLog and AllocationLog
   */
  async reassignSubOrder(subOrderId: string, newSellerId: string, reason?: string) {
    if (!subOrderId) throw new BadRequestAppException('subOrderId is required');
    if (!newSellerId) throw new BadRequestAppException('sellerId is required');

    // 1. Get the sub-order with items
    const subOrder = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      include: {
        items: true,
        masterOrder: { select: { id: true, orderNumber: true, orderStatus: true, shippingAddressSnapshot: true } },
      },
    });

    if (!subOrder) throw new NotFoundAppException(`Sub-order ${subOrderId} not found`);

    if (subOrder.sellerId === newSellerId) {
      throw new BadRequestAppException('Sub-order is already assigned to this seller');
    }

    // Allow reassignment for OPEN or REJECTED sub-orders (REJECTED from seller reject flow)
    if (subOrder.acceptStatus !== 'OPEN' && subOrder.acceptStatus !== 'REJECTED') {
      throw new BadRequestAppException(
        `Cannot reassign sub-order with accept status ${subOrder.acceptStatus}. Only OPEN or REJECTED sub-orders can be reassigned.`,
      );
    }

    const previousSellerId = subOrder.sellerId;

    // 2. Validate new seller exists and is active
    const newSeller = await this.prisma.seller.findUnique({
      where: { id: newSellerId },
      select: { id: true, status: true, sellerName: true, sellerShopName: true },
    });

    if (!newSeller) throw new NotFoundAppException(`Seller ${newSellerId} not found`);
    if (newSeller.status !== 'ACTIVE') {
      throw new BadRequestAppException(`Seller ${newSellerId} is not active (status: ${newSeller.status})`);
    }

    // 3. For each item, verify the new seller has a mapping and sufficient stock
    for (const item of subOrder.items) {
      const mapping = await this.prisma.sellerProductMapping.findFirst({
        where: {
          sellerId: newSellerId,
          productId: item.productId,
          variantId: item.variantId,
          isActive: true,
        },
      });

      if (!mapping) {
        throw new BadRequestAppException(
          `Seller ${newSellerId} does not have an active mapping for product ${item.productId}${item.variantId ? ` / variant ${item.variantId}` : ''}`,
        );
      }

      const available = mapping.stockQty - mapping.reservedQty;
      if (available < item.quantity) {
        throw new BadRequestAppException(
          `Seller ${newSellerId} has insufficient stock for product ${item.productId}: available=${available}, required=${item.quantity}`,
        );
      }
    }

    const now = new Date();
    const acceptDeadlineAt = new Date(now.getTime() + ACCEPT_DEADLINE_MS);

    // 4. Execute reassignment in a transaction
    await this.prisma.$transaction(async (tx) => {
      // Release current seller's reservations for this sub-order
      const currentReservations = await tx.stockReservation.findMany({
        where: {
          orderId: subOrder.masterOrderId,
          status: { in: ['RESERVED', 'CONFIRMED'] },
          mapping: { sellerId: previousSellerId },
        },
      });

      for (const res of currentReservations) {
        if (res.status === 'CONFIRMED') {
          // Stock was already deducted from stockQty — restore it
          await tx.stockReservation.update({
            where: { id: res.id },
            data: { status: 'RELEASED' },
          });
          await tx.sellerProductMapping.update({
            where: { id: res.mappingId },
            data: { stockQty: { increment: res.quantity } },
          });
        } else if (res.status === 'RESERVED') {
          // Stock was only reserved — release the reservation
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

      // Create new reservations for the new seller
      for (const item of subOrder.items) {
        const newMapping = await tx.sellerProductMapping.findFirst({
          where: {
            sellerId: newSellerId,
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
              orderId: subOrder.masterOrderId,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            },
          });

          await tx.sellerProductMapping.update({
            where: { id: newMapping.id },
            data: { reservedQty: { increment: item.quantity } },
          });
        }
      }

      // Update sub-order: new seller, reset accept status to OPEN, set deadline
      await tx.subOrder.update({
        where: { id: subOrderId },
        data: {
          sellerId: newSellerId,
          acceptStatus: 'OPEN',
          fulfillmentStatus: 'UNFULFILLED',
          acceptDeadlineAt,
        },
      });

      // If master order was in EXCEPTION_QUEUE, move it back to ROUTED_TO_SELLER
      if (subOrder.masterOrder.orderStatus === 'EXCEPTION_QUEUE') {
        await tx.masterOrder.update({
          where: { id: subOrder.masterOrderId },
          data: { orderStatus: 'ROUTED_TO_SELLER' },
        });
      }

      // Log in AllocationLog
      for (const item of subOrder.items) {
        await tx.allocationLog.create({
          data: {
            productId: item.productId,
            variantId: item.variantId,
            customerPincode: 'ADMIN_REASSIGN',
            allocatedSellerId: newSellerId,
            allocationReason: `Admin manual reassignment: from seller ${previousSellerId} to ${newSellerId}${reason ? ` — ${reason}` : ''}`,
            isReallocated: true,
            orderId: subOrder.masterOrderId,
          },
        });
      }
    });

    // 5. Log in OrderReassignmentLog (outside transaction — best effort)
    await this.prisma.orderReassignmentLog.create({
      data: {
        subOrderId,
        masterOrderId: subOrder.masterOrderId,
        fromSellerId: previousSellerId,
        toSellerId: newSellerId,
        reason: reason || 'Admin manual reassignment',
        successful: true,
        newSubOrderId: null, // same sub-order, just reassigned
      },
    }).catch(() => {});

    // 6. Publish event
    await this.eventBus.publish({
      eventName: 'orders.sub_order.reassigned',
      aggregate: 'SubOrder',
      aggregateId: subOrderId,
      occurredAt: now,
      payload: {
        subOrderId,
        masterOrderId: subOrder.masterOrderId,
        orderNumber: subOrder.masterOrder.orderNumber,
        fromSellerId: previousSellerId,
        toSellerId: newSellerId,
        reason: reason || 'Admin manual reassignment',
      },
    }).catch(() => {});

    // Return updated sub-order
    return this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      include: {
        items: true,
        seller: { select: { id: true, sellerName: true, sellerShopName: true, email: true } },
      },
    });
  }

  /**
   * Get reassignment history for a master order.
   */
  async getReassignmentHistory(masterOrderId: string) {
    return this.prisma.orderReassignmentLog.findMany({
      where: { masterOrderId },
      orderBy: { createdAt: 'desc' },
    });
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
        orderNumber: { contains: filters.search, mode: 'insensitive' },
      };
    }

    const [subOrders, total] = await Promise.all([
      this.prisma.subOrder.findMany({
        where,
        include: {
          items: true,
          masterOrder: {
            select: {
              orderNumber: true,
              orderStatus: true,
              paymentMethod: true,
              createdAt: true,
              shippingAddressSnapshot: true,
              customer: { select: { firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.subOrder.count({ where }),
    ]);
    return { subOrders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getSellerOrder(id: string, sellerId: string) {
    // Sellers should only see orders that have been verified and routed (or beyond)
    const routedOrLaterStatuses = [
      'ROUTED_TO_SELLER',
      'SELLER_ACCEPTED',
      'DISPATCHED',
      'DELIVERED',
    ] as const;

    const subOrder = await this.prisma.subOrder.findFirst({
      where: {
        id,
        sellerId,
        masterOrder: {
          orderStatus: { in: [...routedOrLaterStatuses] },
        },
      },
      include: {
        items: true,
        commissionRecords: true,
        masterOrder: {
          select: {
            orderNumber: true,
            orderStatus: true,
            shippingAddressSnapshot: true,
            paymentMethod: true,
            createdAt: true,
            customer: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
    });
    if (!subOrder) throw new NotFoundAppException('Order not found');
    return subOrder;
  }

  async sellerAcceptOrder(id: string, sellerId: string, options?: { expectedDispatchDate?: string }) {
    const subOrder = await this.prisma.subOrder.findFirst({ where: { id, sellerId }, select: { id: true, acceptStatus: true, masterOrderId: true } });
    if (!subOrder) throw new NotFoundAppException('Order not found');
    if (subOrder.acceptStatus !== 'OPEN') {
      throw new BadRequestAppException(`Order is already ${subOrder.acceptStatus}`);
    }
    const updateData: any = { acceptStatus: 'ACCEPTED' };
    if (options?.expectedDispatchDate) {
      updateData.expectedDispatchDate = new Date(options.expectedDispatchDate);
    }
    const updated = await this.prisma.subOrder.update({ where: { id }, data: updateData });

    // Update master order status to SELLER_ACCEPTED
    await this.prisma.masterOrder.update({
      where: { id: subOrder.masterOrderId },
      data: { orderStatus: 'SELLER_ACCEPTED' },
    });

    return updated;
  }

  // T5: Seller reject with reassignment logic
  async sellerRejectOrder(id: string, sellerId: string, options?: { reason?: string; note?: string }) {
    const subOrder = await this.prisma.subOrder.findFirst({
      where: { id, sellerId },
      include: {
        items: true,
        masterOrder: {
          select: {
            id: true,
            orderNumber: true,
            shippingAddressSnapshot: true,
            customerId: true,
          },
        },
      },
    });
    if (!subOrder) throw new NotFoundAppException('Order not found');
    if (subOrder.acceptStatus !== 'OPEN') {
      throw new BadRequestAppException(`Order is already ${subOrder.acceptStatus}`);
    }

    // Mark current sub-order as rejected
    await this.prisma.subOrder.update({
      where: { id },
      data: {
        acceptStatus: 'REJECTED',
        fulfillmentStatus: 'CANCELLED',
        rejectionReason: options?.reason || null,
        rejectionNote: options?.note || null,
      },
    });

    // Restore stock for the rejected seller's confirmed reservations
    const rejectedReservations = await this.prisma.stockReservation.findMany({
      where: {
        orderId: subOrder.masterOrder.id,
        status: { in: ['RESERVED', 'CONFIRMED'] },
        mapping: { sellerId },
      },
    });

    for (const res of rejectedReservations) {
      if (res.status === 'CONFIRMED') {
        // Stock was already deducted from stockQty — restore it
        await this.prisma.sellerProductMapping.update({
          where: { id: res.mappingId },
          data: { stockQty: { increment: res.quantity } },
        });
      } else if (res.status === 'RESERVED') {
        // Stock was only reserved — release the reservation
        await this.prisma.sellerProductMapping.update({
          where: { id: res.mappingId },
          data: { reservedQty: { decrement: res.quantity } },
        });
      }
      await this.prisma.stockReservation.update({
        where: { id: res.id },
        data: { status: 'RELEASED' },
      });
    }

    // T5: Attempt reassignment for each item
    const addressSnapshot = subOrder.masterOrder.shippingAddressSnapshot as any;
    const customerPincode = addressSnapshot?.postalCode;

    let reassignmentSuccessful = false;
    let newSubOrderId: string | null = null;
    let newSellerId: string | null = null;

    if (customerPincode) {
      try {
        // Find ALL sellers who have already rejected this master order
        // so we never reassign to a seller who already rejected
        const previousRejections = await this.prisma.subOrder.findMany({
          where: {
            masterOrderId: subOrder.masterOrder.id,
            acceptStatus: 'REJECTED',
          },
          select: { sellerId: true },
        });
        const rejectedSellerIds = new Set(previousRejections.map(r => r.sellerId));
        // Also include the current rejecting seller
        rejectedSellerIds.add(sellerId);

        // Find all mapping IDs belonging to rejected sellers for this product
        const rejectedMappingIds: string[] = [];
        for (const item of subOrder.items) {
          const mappings = await this.prisma.sellerProductMapping.findMany({
            where: {
              productId: item.productId,
              variantId: item.variantId,
              sellerId: { in: Array.from(rejectedSellerIds) },
            },
            select: { id: true },
          });
          rejectedMappingIds.push(...mappings.map(m => m.id));
        }

        // Group items by productId/variantId for reallocation
        for (const item of subOrder.items) {
          const reallocation = await this.allocationService.allocate({
            productId: item.productId,
            variantId: item.variantId ?? undefined,
            customerPincode,
            quantity: item.quantity,
            excludeMappingIds: rejectedMappingIds,
          });

          if (reallocation.serviceable && reallocation.primary) {
            // Reserve stock for new seller
            const reservation = await this.allocationService.reserveStock({
              mappingId: reallocation.primary.mappingId,
              quantity: item.quantity,
              orderId: subOrder.masterOrder.id,
              expiresInMinutes: 60, // 1 hour for reassignment
            });

            // Confirm reservation immediately since order already exists
            await this.allocationService.confirmReservation(
              reservation.id,
              subOrder.masterOrder.id,
            );

            // Create new sub-order for the new seller
            const acceptDeadlineAt = new Date(Date.now() + ACCEPT_DEADLINE_MS);
            const newSubOrder = await this.prisma.subOrder.create({
              data: {
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
    // instead of cancelling — keep it alive for admin manual handling
    if (!reassignmentSuccessful) {
      // Move master order to EXCEPTION_QUEUE for manual admin intervention
      await this.prisma.masterOrder.update({
        where: { id: subOrder.masterOrder.id },
        data: { orderStatus: 'EXCEPTION_QUEUE' },
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
          reason: 'Seller rejected and no alternative seller available — awaiting manual reassignment',
          rejectedSubOrderId: id,
          rejectedSellerId: sellerId,
        },
      });
    }

    // Log the reassignment attempt
    await this.prisma.orderReassignmentLog.create({
      data: {
        subOrderId: id,
        masterOrderId: subOrder.masterOrder.id,
        fromSellerId: sellerId,
        toSellerId: newSellerId,
        reason: 'Seller rejected the order',
        successful: reassignmentSuccessful,
        newSubOrderId,
      },
    }).catch(() => {});

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
  async sellerUpdateFulfillmentStatus(id: string, sellerId: string, status: string) {
    const subOrder = await this.prisma.subOrder.findFirst({ where: { id, sellerId }, select: { id: true, acceptStatus: true, fulfillmentStatus: true, masterOrderId: true } });
    if (!subOrder) throw new NotFoundAppException('Order not found');
    if (subOrder.acceptStatus !== 'ACCEPTED') {
      throw new BadRequestAppException('Order must be accepted before updating fulfillment status');
    }

    // Seller can only move: UNFULFILLED → PACKED → SHIPPED
    // DELIVERED must be confirmed by admin
    const validTransitions: Record<string, string[]> = {
      UNFULFILLED: ['PACKED'],
      PACKED: ['SHIPPED'],
    };

    const allowed = validTransitions[subOrder.fulfillmentStatus] || [];
    if (!allowed.includes(status)) {
      if (status === 'DELIVERED') {
        throw new BadRequestAppException(
          'Delivery must be confirmed by admin. Seller can only update status up to SHIPPED.',
        );
      }
      if (status === 'FULFILLED') {
        throw new BadRequestAppException(
          'FULFILLED status is deprecated. Use PACKED → SHIPPED flow instead.',
        );
      }
      throw new BadRequestAppException(
        `Cannot transition from ${subOrder.fulfillmentStatus} to ${status}. Allowed: ${allowed.join(', ') || 'none (seller flow complete)'}`,
      );
    }

    const updateData: any = { fulfillmentStatus: status };

    const updated = await this.prisma.subOrder.update({ where: { id }, data: updateData });

    // Update master order status to reflect fulfillment progress
    if (status === 'SHIPPED') {
      await this.prisma.masterOrder.update({
        where: { id: subOrder.masterOrderId },
        data: { orderStatus: 'DISPATCHED' },
      });
    }

    // Publish fulfillment status change event
    await this.eventBus.publish({
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
    }).catch(() => {});

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

  async listCustomerOrders(customerId: string, page: number, limit: number) {
    const where = { customerId };
    const [orders, total] = await Promise.all([
      this.prisma.masterOrder.findMany({
        where,
        include: {
          subOrders: {
            include: {
              items: true,
              // Exclude seller info from customer-facing response
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.masterOrder.count({ where }),
    ]);

    // Strip seller information — customers should not see seller names
    // Add customer-friendly status labels
    const sanitized = orders.map((o) => ({
      ...o,
      orderStatusLabel: this.mapOrderStatusLabel(o.orderStatus),
      subOrders: o.subOrders.map((so) => ({
        id: so.id,
        subTotal: so.subTotal,
        paymentStatus: so.paymentStatus,
        fulfillmentStatus: so.fulfillmentStatus,
        acceptStatus: so.acceptStatus,
        deliveredAt: so.deliveredAt,
        items: so.items,
      })),
    }));

    return { orders: sanitized, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getCustomerOrder(customerId: string, orderNumber: string) {
    const order = await this.prisma.masterOrder.findFirst({
      where: { orderNumber, customerId },
      include: {
        subOrders: {
          include: {
            items: true,
          },
        },
      },
    });

    if (!order) throw new NotFoundAppException('Order not found');

    // Strip seller information — show "Fulfilled by SPORTSMART" label
    // Add customer-friendly status label
    return {
      ...order,
      orderStatusLabel: this.mapOrderStatusLabel(order.orderStatus),
      subOrders: order.subOrders.map((so) => ({
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
