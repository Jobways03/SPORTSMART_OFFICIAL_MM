import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserAuthGuard } from '../../../../core/guards';
import { OrdersService } from '../../application/services/orders.service';
import { OrderTimelineService } from '../../application/services/order-timeline.service';
import { ShipmentEvidenceService } from '../../../shipping/application/services/shipment-evidence.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { ListCustomerOrdersDto } from '../dtos/list-customer-orders.dto';

// Phase 197 (My-Orders audit #5) — order-number shape guard. Format is
// `SM${year}${seq}`; the seq pad was widened from 4 to 7 in Phase 197
// (Checkout audit #3) but legacy rows still carry 4-digit suffixes, so
// accept 4–7 digits after the 4-digit year. Bare param validation here
// (the global ValidationPipe doesn't reach a raw @Param string) keeps a
// junk order-number from reaching the DB lookup.
const ORDER_NUMBER_PATTERN = /^SM\d{4}\d{4,7}$/;
function assertOrderNumber(orderNumber: string): void {
  if (!ORDER_NUMBER_PATTERN.test(orderNumber)) {
    throw new BadRequestAppException('Invalid order number');
  }
}

@ApiTags('Customer Orders')
@Controller('customer/orders')
@UseGuards(UserAuthGuard)
export class CustomerOrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    // Phase 84 (2026-05-23) — visibility-filtered timeline reader.
    private readonly timeline: OrderTimelineService,
    // Phase 88 (2026-05-23) — Gap #8 customer POD surface.
    private readonly shipmentEvidence: ShipmentEvidenceService,
    private readonly prisma: PrismaService,
  ) {}

  // Phase 197 (My-Orders audit #4) — @Throttle on the listing. A read
  // endpoint, but an authed scraper could otherwise loop it; 60/min is
  // generous for a human browsing their orders.
  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async listOrders(@Req() req: any, @Query() query: ListCustomerOrdersDto) {
    const pageNum = query.page ?? 1;
    const limitNum = query.limit ?? 20;

    const data = await this.ordersService.listCustomerOrders(
      req.userId,
      pageNum,
      limitNum,
      // Phase 197 (My-Orders audit #7) — server-side status bucket.
      query.status ?? 'all',
    );

    return { success: true, message: 'Orders retrieved', data };
  }

  @Get(':orderNumber')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getOrder(
    @Req() req: any,
    @Param('orderNumber') orderNumber: string,
  ) {
    assertOrderNumber(orderNumber);
    const data = await this.ordersService.getCustomerOrder(req.userId, orderNumber);
    return { success: true, message: 'Order retrieved', data };
  }

  /**
   * Phase 84 (2026-05-23) — order timeline audit Gap #5/#18.
   *
   * Returns the customer-visible slice of `order_status_history`.
   *   • visibility = CUSTOMER_VISIBLE only — ADMIN_ONLY rows
   *     (claim acquired, payment intent created, refund failed, etc.)
   *     are filtered server-side; the customer cannot escalate by
   *     guessing query params.
   *   • Per-eventType metadata whitelist — tracking URL surfaces on
   *     SUBORDER_SHIPPED, refund amount on REFUND_INITIATED; no
   *     internal actor name / reason / staff id leaks.
   *   • Ownership-scoped via the master order's orderNumber → the
   *     getCustomerOrder lookup throws 404 if the order doesn't
   *     belong to req.userId.
   */
  @Get(':orderNumber/timeline')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getTimeline(
    @Req() req: any,
    @Param('orderNumber') orderNumber: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    // Phase 84 — ownership check via existing getCustomerOrder
    // lookup. The cheap path is to resolve the master order id
    // first (404s if not the caller's order), then read the timeline.
    const order = await this.ordersService.getCustomerOrder(
      req.userId,
      orderNumber,
    );
    if (!order) {
      throw new NotFoundAppException('Order not found');
    }
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const parsedBefore = before ? new Date(before) : undefined;
    if (parsedBefore && Number.isNaN(parsedBefore.getTime())) {
      throw new BadRequestAppException('Invalid before datetime');
    }
    const data = await this.timeline.getTimeline((order as any).id, {
      audience: 'CUSTOMER',
      limit: parsedLimit,
      before: parsedBefore,
    });
    return { success: true, message: 'Timeline retrieved', data };
  }

  /**
   * Phase 88 (2026-05-23) — Shipment Evidence Gap #8.
   *
   * Customer-visible Proof of Delivery (or RTO_PROOF). Pre-Phase-88
   * the customer had no way to see the courier's POD photo even
   * after delivery; chargebacks went undefended. This endpoint
   * scopes the lookup to the requesting user's sub-orders and
   * returns ONLY the POD kind (packing photos contain seller
   * inventory info and stay seller/admin-only).
   *
   * Ownership: the sub-order's master order must belong to the
   * requesting user. 404 (not 403) on mismatch so a probing client
   * can't enumerate sub-order ids.
   */
  @Get('sub-orders/:subOrderId/pod')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getPod(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
  ) {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: {
        id: true,
        fulfillmentStatus: true,
        masterOrder: { select: { customerId: true } },
      },
    });
    if (!sub || sub.masterOrder.customerId !== req.userId) {
      throw new NotFoundAppException('Sub-order not found');
    }
    if (
      sub.fulfillmentStatus !== 'DELIVERED' &&
      sub.fulfillmentStatus !== 'CANCELLED'
    ) {
      // Pre-delivery — no POD yet. Distinct from "missing POD" so
      // the frontend can render a placeholder instead of an error.
      return { success: true, message: 'No POD yet', data: null };
    }

    const pod = await this.shipmentEvidence.getCustomerPod(subOrderId);
    return { success: true, message: 'POD retrieved', data: pod };
  }
}
