import { Injectable, Inject, forwardRef } from '@nestjs/common';
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
import { MoneyDualWriteHelper } from '../../../../core/money/money-dual-write.helper';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { OrdersService } from '../../../orders/application/services/orders.service';

// Return window memoised at construct time from RETURN_WINDOW_DAYS env.
// Prod default 14 days; matches OrdersService. See orders.service.ts.
const ACCEPT_DEADLINE_MS = 24 * 60 * 60 * 1000; // 24 hours
const DISPATCH_DEADLINE_HOURS = 48;

@Injectable()
export class FranchiseOrdersService {
  private readonly returnWindowMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: FranchiseInventoryService,
    private readonly commissionService: FranchiseCommissionService,
    private readonly catalogFacade: CatalogPublicFacade,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    // Phase 7 (PR 7.7) — paise-sibling dual-write for the subOrder
    // split-out path that creates a follow-up sub-order with the
    // item's totalPrice as the new subTotal.
    private readonly moneyDualWrite: MoneyDualWriteHelper,
    private readonly env: EnvService,
    // Phase 82 (2026-05-23) — pack/ship audit. Franchise fulfillment
    // updates delegate to the unified `OrdersService.updateFulfillment-
    // StatusInternal` so the audit columns, evidence gate, master
    // rollup, and audit log all fire symmetrically with the seller
    // path. Injected via forwardRef to avoid the boot-order cycle
    // (orders → franchise → orders).
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
  ) {
    this.logger.setContext('FranchiseOrdersService');
    const days = this.env.getNumber('RETURN_WINDOW_DAYS', 14);
    this.returnWindowMs = Math.round(days * 24 * 60 * 60 * 1000);
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

  /**
   * Global count of franchise sub-orders matching a status filter — across ALL
   * franchises. Powers the franchise-admin sidebar "Orders" badge (new orders
   * awaiting acceptance). Lightweight: a single COUNT, no row hydration.
   */
  async countOrders(filters?: {
    acceptStatus?: string;
    fulfillmentStatus?: string;
  }): Promise<{ total: number }> {
    const where: Prisma.SubOrderWhereInput = {
      fulfillmentNodeType: 'FRANCHISE',
    };
    if (filters?.acceptStatus) where.acceptStatus = filters.acceptStatus as any;
    if (filters?.fulfillmentStatus) {
      where.fulfillmentStatus = filters.fulfillmentStatus as any;
    }
    const total = await this.prisma.subOrder.count({ where });
    return { total };
  }

  /**
   * Global, filterable list of franchise sub-orders across ALL franchises —
   * powers the franchise-admin flat Orders table (parity with the seller-admin
   * orders page). One row = one franchise sub-order. Status filters split
   * across the master order (orderStatus / paymentStatus) and the sub-order
   * (fulfillmentStatus / acceptStatus).
   */
  async listAllOrders(
    page: number,
    limit: number,
    filters?: {
      search?: string;
      orderStatus?: string;
      paymentStatus?: string;
      fulfillmentStatus?: string;
      acceptStatus?: string;
    },
  ) {
    const where: Prisma.SubOrderWhereInput = {
      fulfillmentNodeType: 'FRANCHISE',
    };
    if (filters?.fulfillmentStatus) {
      where.fulfillmentStatus = filters.fulfillmentStatus as any;
    }
    if (filters?.acceptStatus) {
      where.acceptStatus = filters.acceptStatus as any;
    }

    const masterWhere: Prisma.MasterOrderWhereInput = {};
    if (filters?.orderStatus) masterWhere.orderStatus = filters.orderStatus as any;
    if (filters?.paymentStatus) masterWhere.paymentStatus = filters.paymentStatus as any;
    if (filters?.search) {
      const s = filters.search.trim();
      masterWhere.OR = [
        { orderNumber: { contains: s, mode: 'insensitive' } },
        { customer: { email: { contains: s, mode: 'insensitive' } } },
        { customer: { firstName: { contains: s, mode: 'insensitive' } } },
        { customer: { lastName: { contains: s, mode: 'insensitive' } } },
      ];
    }
    if (Object.keys(masterWhere).length > 0) {
      where.masterOrder = masterWhere;
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
              totalAmount: true,
              paymentMethod: true,
              paymentStatus: true,
              orderStatus: true,
              createdAt: true,
              shippingAddressSnapshot: true,
              customer: { select: { firstName: true, lastName: true, email: true } },
            },
          },
          franchise: { select: { id: true, businessName: true } },
          _count: { select: { items: true } },
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
            // Needed for the wallet-aware payment label so a wallet-paid order
            // isn't shown as "Cash on Delivery".
            walletAmountUsedInPaise: true,
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
    return this.withPaymentLabel(subOrder);
  }

  /**
   * Admin (oversight) variant of getOrder — same shape but NOT scoped to a
   * franchiseId, since the franchise-admin views any partner's sub-order.
   * Includes the owning franchise so the admin detail page can label it.
   */
  async getOrderForAdmin(subOrderId: string) {
    const subOrder = await this.prisma.subOrder.findFirst({
      where: { id: subOrderId, fulfillmentNodeType: 'FRANCHISE' },
      include: {
        masterOrder: {
          select: {
            id: true,
            orderNumber: true,
            customerId: true,
            shippingAddressSnapshot: true,
            totalAmount: true,
            paymentMethod: true,
            // Needed for the wallet-aware payment label (see getOrder).
            walletAmountUsedInPaise: true,
            paymentStatus: true,
            orderStatus: true,
            createdAt: true,
          },
        },
        items: true,
        franchise: { select: { id: true, businessName: true } },
      },
    });
    if (!subOrder) {
      throw new NotFoundAppException('Order not found');
    }
    return this.withPaymentLabel(subOrder);
  }

  /**
   * Attach the wallet-aware payment label to a sub-order's master so the
   * franchise portal + franchise-admin views don't show a wallet-paid order as
   * "Cash on Delivery". Reuses OrdersService.deriveEffectivePaymentLabel so the
   * logic stays in one place. The wallet amount is stringified (BigInt-safe).
   */
  private withPaymentLabel<T extends { masterOrder?: any }>(subOrder: T): T {
    const master: any = subOrder.masterOrder ?? {};
    return {
      ...subOrder,
      masterOrder: {
        ...master,
        paymentMethodLabel: this.ordersService.deriveEffectivePaymentLabel(master),
        walletAmountUsedInPaise:
          master.walletAmountUsedInPaise != null
            ? master.walletAmountUsedInPaise.toString()
            : '0',
      },
    };
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
    // Phase 80 (2026-05-22) — acceptance audit Gap #4. Late-accept
    // block. Mirror of the seller-side check so a franchise can't
    // accept past acceptDeadlineAt while the SLA cron is between
    // ticks.
    if (
      subOrder.acceptDeadlineAt &&
      new Date() > subOrder.acceptDeadlineAt
    ) {
      throw new BadRequestAppException(
        'Acceptance window has expired — the order has been auto-rejected.',
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

    // Phase 80 — Gap #17 / R2. FOR UPDATE + re-check inside tx so
    // cron auto-reject and franchise manual accept serialise on a
    // single row lock.
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<
        Array<{ id: string; accept_status: string; accept_deadline_at: Date | null }>
      >`
        SELECT id, accept_status, accept_deadline_at
        FROM sub_orders
        WHERE id = ${subOrderId}
        FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked) throw new NotFoundAppException('Order not found');
      if (locked.accept_status !== 'OPEN') {
        throw new BadRequestAppException(
          `Order is already ${locked.accept_status}`,
        );
      }
      if (locked.accept_deadline_at && new Date() > locked.accept_deadline_at) {
        throw new BadRequestAppException(
          'Acceptance window has expired — the order has been auto-rejected.',
        );
      }
      const updateData: any = {
        acceptStatus: 'ACCEPTED',
        // Phase 80 — Gap #7. Acceptance timestamp + actor (franchise id).
        acceptedAt: now,
        acceptedBy: franchiseId,
      };
      updateData.expectedDispatchDate = options?.expectedDispatchDate
        ? new Date(options.expectedDispatchDate)
        : new Date(Date.now() + DISPATCH_DEADLINE_HOURS * 60 * 60 * 1000);
      return tx.subOrder.update({
        where: { id: subOrderId },
        data: updateData,
      });
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

  // Phase 80 (2026-05-22) — acceptance audit Gaps #5/#7/#17/#19/#21.
  //   • `auto` option discriminates the cron-driven path (Gap #19).
  //   • SELECT FOR UPDATE inside a tx serialises the cron auto-reject
  //     vs franchise manual reject (Gap #17).
  //   • Audit columns rejectedAt / rejectedBy / rejectionType / autoRejectedAt.
  async rejectOrder(
    subOrderId: string,
    franchiseId: string,
    options?: { reason?: string; note?: string; auto?: boolean },
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

    const isAuto = !!options?.auto;
    const now = new Date();
    // Phase 80 — Gap #17. FOR UPDATE on the sub-order row + re-check
    // inside the tx so we serialise with manual-accept and any other
    // concurrent cron tick.
    await this.prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<
        Array<{ id: string; accept_status: string }>
      >`
        SELECT id, accept_status
        FROM sub_orders
        WHERE id = ${subOrderId}
        FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked) throw new NotFoundAppException('Order not found');
      if (locked.accept_status !== 'OPEN') {
        throw new BadRequestAppException(
          `Order is already ${locked.accept_status}`,
        );
      }
      await tx.subOrder.update({
        where: { id: subOrderId },
        data: {
          acceptStatus: 'REJECTED',
          fulfillmentStatus: 'CANCELLED',
          rejectionReason: options?.reason || null,
          rejectionNote: options?.note || null,
          // Phase 80 audit columns.
          rejectedAt: now,
          rejectedBy: franchiseId,
          rejectionType: isAuto ? 'AUTO_SLA' : 'MANUAL',
          autoRejectedAt: isAuto ? now : null,
        } as any,
      });
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

      // Phase 79 (2026-05-22) — history audit Gaps #2/#6/#12.
      //   • Discriminator columns populated so the history UI knows
      //     this was a franchise (not stuffed-in-seller-slot) row.
      //   • eventType: AUTO_AFTER_FRANCHISE_REJECT — distinct from
      //     the seller-reject cascade so an ops analyst can break
      //     down "% of reassigns by cause" cleanly.
      //   • failureReason captures the policy-level cause (max
      //     attempts exceeded) instead of the seller's rejection
      //     reason which is what `reason` carries.
      await this.prisma.orderReassignmentLog.create({
        data: {
          subOrderId,
          masterOrderId: subOrder.masterOrder.id,
          fromNodeType: 'FRANCHISE',
          fromNodeId: franchiseId,
          toNodeType: 'SELLER',
          toNodeId: null,
          fromSellerId: franchiseId,
          toSellerId: null,
          reason: options?.reason || 'Franchise rejected the order',
          successful: false,
          failureReason: `Max reassignment attempts (${MAX_REASSIGNMENT_ATTEMPTS}) exceeded — moved to exception queue`,
          newSubOrderId: null,
          reassignedBy: null,
          eventType: 'AUTO_AFTER_FRANCHISE_REJECT',
        },
      });

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
              // Phase 52 polish (2026-05-21) — pass customerId so the
              // reallocation reservation is attributed to the
              // customer for forensic queries.
              const reservation =
                await this.catalogFacade.reserveStock({
                  mappingId: primary.mappingId,
                  quantity: item.quantity,
                  orderId: subOrder.masterOrder.id,
                  expiresInMinutes: 60,
                  customerId: subOrder.masterOrder.customerId,
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
              data: this.moneyDualWrite.applyPaise('subOrder', {
                masterOrderId: subOrder.masterOrder.id,
                ...(primary.nodeType === 'SELLER'
                  ? { sellerId: primary.sellerId }
                  : { franchiseId: primary.franchiseId! }),
                fulfillmentNodeType: primary.nodeType,
                // Pass the Decimal directly so the helper's toPaise
                // can convert exactly via .mul(100).toFixed(0). The
                // earlier `Number(item.totalPrice)` collapse would
                // produce a fractional JS Number that toPaise rejects.
                subTotal: item.totalPrice,
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
              }),
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

    // Phase 79 (2026-05-22) — history audit Gaps #2/#4/#6/#12.
    // Same shape as the max-attempts branch above. successful=true
    // is possible here when a SELLER picked up the rejected
    // franchise's items; toNodeType is therefore 'SELLER'. The
    // failureReason is populated only when the cascade didn't find
    // a candidate.
    await this.prisma.orderReassignmentLog.create({
      data: {
        subOrderId,
        masterOrderId: subOrder.masterOrder.id,
        fromNodeType: 'FRANCHISE',
        fromNodeId: franchiseId,
        toNodeType: 'SELLER',
        toNodeId: newSellerId,
        fromSellerId: franchiseId,
        toSellerId: newSellerId,
        reason: options?.reason || 'Franchise rejected the order',
        successful: reassignmentSuccessful,
        failureReason: reassignmentSuccessful
          ? null
          : customerPincode
            ? 'Auto-reassignment found no eligible alternate seller at this pincode'
            : 'Auto-reassignment could not run — shipping pincode missing from address snapshot',
        newSubOrderId,
        reassignedBy: null,
        eventType: 'AUTO_AFTER_FRANCHISE_REJECT',
      },
    });

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
  //
  // Phase 82 (2026-05-23) — packing & shipping audit Gaps #2/#3/#4/#6.
  // Pre-Phase-82 the franchise side diverged from the seller path in
  // five ways: (a) no mandatory AWB/courier check, (b) no 4-photo
  // evidence gate, (c) no FSM assertTransition defense, (d) no tax
  // invoice trigger, (e) no audit log. All of those are closed by
  // delegating to the unified OrdersService.updateFulfillmentStatusInternal
  // path which fires the same guards regardless of actor.
  //
  // The franchise-side `confirmShipment` inventory-ledger step still
  // runs here (post-status-update) because it's franchise-specific
  // bookkeeping that doesn't belong on the seller path.
  async updateFulfillmentStatus(
    subOrderId: string,
    franchiseId: string,
    status: string,
    tracking?: { trackingNumber?: string; courierName?: string },
  ) {
    // Phase 82 — delegate to the unified writer. Ownership check is
    // wrapped in a closure that the writer invokes once.
    const updated = await this.ordersService.updateFulfillmentStatusInternal({
      subOrderId,
      actorId: franchiseId,
      actorKind: 'FRANCHISE',
      status,
      extra: {
        trackingNumber: tracking?.trackingNumber,
        courierName: tracking?.courierName,
      },
      ownershipCheck: () =>
        this.prisma.subOrder.findFirst({
          where: {
            id: subOrderId,
            franchiseId,
            fulfillmentNodeType: 'FRANCHISE',
          },
        }),
    });

    // Phase 82 — Gap #14 mirror. The unified writer rejects FULFILLED
    // for both actors via the hardcoded allowedTransitions map. The
    // pre-Phase-82 franchise code accepted it; the new path 400s.

    // Franchise-specific post-update: confirm shipment in inventory
    // ledger on SHIPPED. The unified writer handled the FSM gate +
    // audit columns + master rollup + audit log already, so this is
    // pure franchise bookkeeping.
    if (status === 'SHIPPED') {
      const subOrder = await this.prisma.subOrder.findUnique({
        where: { id: subOrderId },
        include: { items: true },
      });
      if (subOrder?.items) {
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
    }

    return updated;
  }

  // ── Mark delivered (admin action or auto via shipping webhook) ─────────
  //
  // Phase 83 (2026-05-23) — delivery confirmation audit Gap #10.
  // Pre-Phase-83 this was a parallel implementation that diverged from
  // OrdersService.deliverSubOrder in five ways:
  //   • No FSM-enforced assertTransition
  //   • Blind master → DELIVERED (no PARTIALLY_DELIVERED rollup)
  //   • Separate event name (franchise.order.delivered) so existing
  //     subscribers on orders.sub_order.delivered missed it
  //   • No audit_log row
  //   • No deliveredBy / deliverySource columns
  //
  // Phase 83 routes through the unified OrdersService.deliverSubOrder
  // path with source=MANUAL_FRANCHISE so every delivery — regardless
  // of actor — goes through the same FSM gate, audit-log writer,
  // and outbox event.
  async markDelivered(
    subOrderId: string,
    opts?: { deliveredBy?: string; deliveryProofUrl?: string },
  ) {
    // Phase 83 — ownership check stays here so a franchise-admin call
    // can't deliver a non-FRANCHISE sub-order via this entry point.
    const subOrder = await this.prisma.subOrder.findFirst({
      where: {
        id: subOrderId,
        fulfillmentNodeType: 'FRANCHISE',
      },
    });
    if (!subOrder) {
      throw new NotFoundAppException('Order not found');
    }
    return this.ordersService.deliverSubOrder(subOrderId, {
      source: 'MANUAL_FRANCHISE',
      deliveredBy: opts?.deliveredBy,
      deliveryProofUrl: opts?.deliveryProofUrl,
    });
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
