import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
  Header,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthGuard, RolesGuard, PermissionsGuard } from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { OrdersService } from '../../application/services/orders.service';
import { OrderTimelineService } from '../../application/services/order-timeline.service';
import { VerifyOrderDto, RejectOrderBodyDto } from '../dtos/verification.dto';
import { ReassignSubOrderDto } from '../dtos/reassign.dto';
import { CancelSubOrderDto } from '../dtos/cancel-sub-order.dto';
import { MarkDeliveredDto } from '../dtos/mark-delivered.dto';
import { MarkCodPaidDto } from '../dtos/mark-cod-paid.dto';
import {
  BadRequestAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';

@ApiTags('Admin Orders')
@Controller('admin/orders')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard)
export class AdminOrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    // Phase 84 (2026-05-23) — order timeline reader.
    private readonly timeline: OrderTimelineService,
  ) {}

  /**
   * Phase 84 (2026-05-23) — order timeline / status history audit
   * Gap #1/#2/#4. Replaces the hardcoded React JSX timeline (which
   * could only render 5 event kinds derived from current
   * denormalized timestamps) with a query-backed, paginated,
   * filterable feed. Returns every event including ADMIN_ONLY rows
   * (claim acquire/release, payment intent created, etc.).
   *
   * Query params:
   *   ?limit=20         (default 50, max 200)
   *   ?before=ISO       cursor — load older events
   *   ?eventType=...    optional eventType filter
   */
  @Get(':id/timeline')
  @Permissions('orders.read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getTimeline(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('eventType') eventType?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const parsedBefore = before ? new Date(before) : undefined;
    if (parsedBefore && Number.isNaN(parsedBefore.getTime())) {
      throw new BadRequestAppException('Invalid before datetime');
    }
    const data = await this.timeline.getTimeline(id, {
      audience: 'ADMIN',
      limit: parsedLimit,
      before: parsedBefore,
      eventType: eventType as any,
    });
    return { success: true, message: 'Timeline retrieved', data };
  }

  @Get()
  @Permissions('orders.read')
  async listOrders(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('fulfillmentStatus') fulfillmentStatus?: string,
    @Query('acceptStatus') acceptStatus?: string,
    @Query('orderStatus') orderStatus?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.ordersService.listOrders({
      page: Math.max(1, parseInt(page || '1', 10) || 1),
      limit: Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20)),
      paymentStatus,
      fulfillmentStatus,
      acceptStatus,
      orderStatus,
      search,
    });
    return { success: true, message: 'Orders retrieved', data };
  }

  @Get(':id')
  @Permissions('orders.read')
  async getOrder(@Param('id') id: string) {
    const data = await this.ordersService.getOrder(id);
    return { success: true, message: 'Order retrieved', data };
  }

  // Phase 75 (2026-05-22) — Phase 73 reject audit Gap #23. Routing
  // preview consumed by the admin order detail page before the
  // verifier clicks "Verify & Route". Read-only — does not mutate
  // AllocationLog.
  @Get(':id/routing-preview')
  @Permissions('orders.read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async previewRouting(@Param('id') id: string) {
    const data = await this.ordersService.previewRouting(id);
    return { success: true, message: 'Routing preview', data };
  }

  @Post(':id/verify')
  // Phase 68 (audit Gaps #3 + #4 + #5) — gated by the dedicated
  // orders.verify permission (was orders.cancel — conflated cancel
  // and verify semantics so a cancel-only admin could verify).
  // The service-side claim check (also added in Phase 68) catches
  // the cross-path race: if another admin is holding a verification
  // queue claim on this order, this direct-verify path errors out
  // so the queue workflow stays canonical.
  //
  // Phase 74 (Phase 73 audit Gaps #13 + #14) — @Throttle +
  // @Idempotent so a double-tap retry returns the original
  // response shape rather than a 400 from the FSM duplicate-
  // transition guard.
  @Permissions('orders.verify')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async verifyOrder(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: VerifyOrderDto,
  ) {
    const data = await this.ordersService.verifyOrder(
      id,
      req.userId,
      body.remarks,
      { ipAddress: req.ip, userAgent: req.headers?.['user-agent'] },
    );
    return { success: true, message: 'Order verified and routed to sellers', data };
  }

  @Patch(':id/reject-order')
  // Phase 74 (Phase 73 audit Gaps #1 + #2 + #6 + #7 + #13 + #14 + #19):
  //   • Dedicated `orders.reject` permission (was orders.cancel
  //     which conflated customer-cancel with verifier-reject).
  //   • Reason body required via DTO (10..500 chars). UI must now
  //     surface a modal; pre-Phase-74 the endpoint accepted no body.
  //   • @Idempotent for retry safety on the prepaid-refund branch
  //     (the underlying RefundInstructionService is itself
  //     idempotent on the saga key, but adding the decorator
  //     stops a network retry from triggering a duplicate audit
  //     log row).
  //   • @Throttle caps the burst rate.
  //   • req.userId threaded into the service so rejectedBy is
  //     captured (column existed but was never written pre-Phase-74).
  //
  // Role gate relaxed from @Roles('SUPER_ADMIN') to permission-only.
  // The verifier role (SELLER_OPERATIONS by default) needs reject
  // rights for the normal verification workflow; the SUPER_ADMIN
  // restriction blocked the entire verification team.
  @Permissions('orders.reject')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async rejectOrder(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: RejectOrderBodyDto,
  ) {
    await this.ordersService.rejectOrder(
      id,
      req.userId,
      body.reason,
      { ipAddress: req.ip, userAgent: req.headers?.['user-agent'] },
    );
    return { success: true, message: 'Order rejected — stock restored, refund initiated if applicable' };
  }

  // The sub-order state-machine overrides below all bypass the normal
  // lifecycle (seller accept → pack → ship → deliver) and can force
  // arbitrary transitions without corresponding commission / stock
  // side-effects. Reserved for SUPER_ADMIN because a wrong transition
  // from a lower-tier admin can detach the ledger from physical reality
  // (e.g. reversing DELIVERED → UNFULFILLED while goods are with the
  // customer). Same principle as the money / account operations locked
  // down in admin-settlement / admin-commission / admin-sellers.
  @Patch('sub-orders/:id/accept')
  @Roles('SUPER_ADMIN')
  @Permissions('orders.cancel')
  async acceptSubOrder(@Param('id') id: string) {
    const data = await this.ordersService.acceptSubOrder(id);
    return { success: true, message: 'Sub-order accepted', data };
  }

  @Patch('sub-orders/:id/reject')
  @Roles('SUPER_ADMIN')
  @Permissions('orders.cancel')
  async rejectSubOrder(@Param('id') id: string) {
    const data = await this.ordersService.rejectSubOrder(id);
    return { success: true, message: 'Sub-order rejected', data };
  }

  @Patch('sub-orders/:id/fulfill')
  @Roles('SUPER_ADMIN')
  @Permissions('orders.cancel')
  async fulfillSubOrder(@Param('id') id: string) {
    const data = await this.ordersService.fulfillSubOrder(id);
    return { success: true, message: 'Sub-order fulfilled', data };
  }

  // Phase 83 (2026-05-23) — delivery confirmation audit Gaps #6/#11/#12.
  //   • Dedicated `orders.deliver` permission (was `orders.cancel`
  //     which conflated cancel/reject/reassign/deliver — Gap #6).
  //   • DTO accepts optional proof URLs (Gap #11).
  //   • Service writes audit_log row + persists deliveredBy and
  //     deliverySource=MANUAL_ADMIN (Gap #3/#12).
  //   • @Throttle + @Idempotent stay aligned with the other admin
  //     order endpoints.
  @Patch('sub-orders/:id/deliver')
  @Permissions('orders.deliver')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async deliverSubOrder(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: MarkDeliveredDto,
  ) {
    const adminId = req?.adminId ?? req?.userId;
    const data = await this.ordersService.deliverSubOrder(id, {
      source: 'MANUAL_ADMIN',
      deliveredBy: adminId,
      deliveryProofUrl: body?.deliveryProofUrl,
      deliverySignatureUrl: body?.deliverySignatureUrl,
      deliveryOtpVerified: body?.deliveryOtpVerified,
    });
    return { success: true, message: 'Sub-order marked as delivered — return window started', data };
  }

  @Post('sub-orders/:subOrderId/mark-delivered')
  @Permissions('orders.deliver')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async markSubOrderDelivered(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Body() body: MarkDeliveredDto,
  ) {
    const adminId = req?.adminId ?? req?.userId;
    const data = await this.ordersService.deliverSubOrder(subOrderId, {
      source: 'MANUAL_ADMIN',
      deliveredBy: adminId,
      deliveryProofUrl: body?.deliveryProofUrl,
      deliverySignatureUrl: body?.deliverySignatureUrl,
      deliveryOtpVerified: body?.deliveryOtpVerified,
    });
    return { success: true, message: 'Sub-order marked as delivered — return window started', data };
  }

  // Phase 168 (COD Mark-Paid audit) — COD cash-collection mark-paid.
  //   #6  @Permissions swapped from the semantically-wrong, untiered
  //        `orders.cancel` to the dedicated CRITICAL `payments.cod.markPaid`.
  //   #13 @Throttle so a compromised admin token can't batch-flip thousands.
  //   #16 @Idempotent so a double-click retry returns the original response
  //        instead of a 400 from the already-PAID guard.
  //   #12 MarkCodPaidDto carries the collected amount + receipt reference.
  // actorId / ip / ua are threaded for the audit row.
  @Patch(':id/mark-paid')
  @Permissions('payments.cod.markPaid')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async markAsPaid(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: MarkCodPaidDto,
  ) {
    await this.ordersService.markAsPaid(id, {
      actorId: req?.adminId ?? req?.userId,
      actorRole: req?.adminRole ?? req?.role,
      collectedAmountInPaise:
        body?.collectedAmountInPaise !== undefined
          ? BigInt(body.collectedAmountInPaise)
          : undefined,
      collectionReference: body?.collectionReference,
      notes: body?.notes,
      varianceReason: body?.varianceReason,
      ipAddress: req?.ip,
      userAgent: req?.headers?.['user-agent'],
    });
    return { success: true, message: 'Order marked as paid' };
  }

  // Phase 168 (COD Mark-Paid audit #10) — per-sub-order COD cash collection for
  // multi-seller orders. Flips ONE delivered sub-order to PAID + recomputes the
  // master (which flips to PAID only when every active sub-order is collected).
  @Patch('sub-orders/:subOrderId/mark-paid')
  @Permissions('payments.cod.markPaid')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async markSubOrderAsPaid(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Body() body: MarkCodPaidDto,
  ) {
    const data = await this.ordersService.markSubOrderAsPaid(subOrderId, {
      actorId: req?.adminId ?? req?.userId,
      actorRole: req?.adminRole ?? req?.role,
      collectedAmountInPaise:
        body?.collectedAmountInPaise !== undefined
          ? BigInt(body.collectedAmountInPaise)
          : undefined,
      collectionReference: body?.collectionReference,
      notes: body?.notes,
      varianceReason: body?.varianceReason,
      ipAddress: req?.ip,
      userAgent: req?.headers?.['user-agent'],
    });
    return { success: true, message: 'Sub-order marked as paid', data };
  }

  // ── Epic 2: Manual Reassignment & Exception Queue ──────────────────────

  /**
   * @deprecated Phase 230 — sellers-ONLY listing. It silently hides franchise
   * candidates, so an admin reassigning from here can miss a closer/better
   * franchise. Use `eligible-nodes` (sellers + franchises). Kept active for
   * back-compat; the `Deprecation` response header signals clients to migrate.
   * Phase 230 also added the dedicated @Throttle — both eligible-* endpoints run
   * a per-item allocator fan-out, so an unthrottled token could hammer the DB.
   */
  @Get('sub-orders/:subOrderId/eligible-sellers')
  @Permissions('orders.read')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Deprecation', 'true')
  @Header('Link', '</admin/orders/sub-orders/:subOrderId/eligible-nodes>; rel="successor-version"')
  async getEligibleSellers(@Param('subOrderId') subOrderId: string) {
    const data = await this.ordersService.getEligibleSellers(subOrderId);
    return { success: true, message: 'Eligible sellers retrieved', data };
  }

  /**
   * Node-agnostic candidate list. Returns both sellers AND franchises that
   * can fulfill this sub-order, each with a `nodeType` discriminator.
   * Prefer this over the legacy `eligible-sellers` endpoint.
   */
  @Get('sub-orders/:subOrderId/eligible-nodes')
  @Permissions('orders.read')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getEligibleNodes(@Param('subOrderId') subOrderId: string) {
    const data = await this.ordersService.getEligibleNodes(subOrderId);
    return { success: true, message: 'Eligible nodes retrieved', data };
  }

  /**
   * Reassign a sub-order to a new fulfillment node.
   *
   * Phase 78 (2026-05-22) — audit Gaps #1/#5/#7/#11/#12/#19. The
   * surface gained:
   *   - DTO validation: reason mandatory (10..500), nodeId UUID-checked,
   *     nodeType enum-checked at the pipe layer (Gap #1, #4, #11).
   *   - Dedicated `orders.reassign` permission (was `orders.cancel`
   *     which conflated cancel/reassign — Gap #7).
   *   - `force: true` requires the additional `orders.reassign.force`
   *     permission so ACCEPTED+UNFULFILLED reassign isn't a default
   *     escalation path (Gap #19).
   *   - @Throttle caps loop-call DoS (Gap #12).
   *   - @Idempotent returns the same response shape on retry — admin
   *     double-tap can't bounce stock between nodes (Gap #15/R8).
   *   - req.adminId is threaded into the service so OrderReassignmentLog
   *     records the actor (Gap #5).
   *
   * Preferred body shape: `{ nodeType: 'SELLER'|'FRANCHISE', nodeId, reason }`.
   * Legacy shape `{ sellerId, reason }` is still accepted and maps to a
   * SELLER target.
   */
  @Post('sub-orders/:subOrderId/reassign')
  @Permissions('orders.reassign')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Idempotent()
  async reassignSubOrder(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Body() body: ReassignSubOrderDto,
  ) {
    const target =
      body.nodeType && body.nodeId
        ? ({ nodeType: body.nodeType, nodeId: body.nodeId } as const)
        : body.sellerId
          ? ({ nodeType: 'SELLER', nodeId: body.sellerId } as const)
          : null;

    if (!target) {
      throw new BadRequestAppException(
        'Reassignment target required — provide { nodeType, nodeId } or legacy { sellerId }',
      );
    }

    if (body.force) {
      const perms: string[] = req?.user?.permissions ?? [];
      if (!perms.includes('orders.reassign.force')) {
        throw new ForbiddenAppException(
          'force=true requires the orders.reassign.force permission',
        );
      }
    }

    const adminId: string | undefined = req?.adminId ?? req?.userId;
    const data = await this.ordersService.reassignSubOrder(
      subOrderId,
      target,
      body.reason,
      adminId,
      { force: !!body.force },
    );
    return { success: true, message: 'Sub-order reassigned successfully', data };
  }

  /**
   * Phase 79 (2026-05-22) — history audit Gaps #7/#10/#11/#15.
   * Canonical reassignment-history endpoint. Returns enriched +
   * cursor-paginated rows so a "Load more" UX can stream additional
   * pages without re-fetching the whole order detail.
   *
   * Query params:
   *   ?limit=20         (default 50, max 100)
   *   ?before=ISO       cursor — load next page (rows older than this)
   *   ?from=ISO&to=ISO  time-range filter (Gap #15)
   *   ?eventType=...    filter by reassignment cause (Gap #6)
   */
  @Get(':id/reassignment-history')
  @Permissions('orders.read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getReassignmentHistory(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('eventType') eventType?: string,
  ) {
    const allowedEventTypes = new Set([
      'ADMIN_MANUAL_OVERRIDE',
      'AUTO_AFTER_SELLER_REJECT',
      'AUTO_AFTER_FRANCHISE_REJECT',
      'AUTO_AFTER_EXCEPTION_REMEDIATE',
    ]);
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const parsedBefore = before ? new Date(before) : undefined;
    const parsedFrom = from ? new Date(from) : undefined;
    const parsedTo = to ? new Date(to) : undefined;
    // Pipe-layer sanity checks on the date inputs; bad strings parse
    // to Invalid Date and we want a 400 instead of a Prisma error.
    for (const [name, d] of [
      ['before', parsedBefore],
      ['from', parsedFrom],
      ['to', parsedTo],
    ] as const) {
      if (d && Number.isNaN(d.getTime())) {
        throw new BadRequestAppException(`Invalid ${name} datetime`);
      }
    }
    if (eventType && !allowedEventTypes.has(eventType)) {
      throw new BadRequestAppException(
        `Invalid eventType: ${eventType}`,
      );
    }
    const data = await this.ordersService.getReassignmentHistory(id, {
      limit: parsedLimit,
      before: parsedBefore,
      from: parsedFrom,
      to: parsedTo,
      eventType: eventType as any,
    });
    return { success: true, message: 'Reassignment history retrieved', data };
  }

  /**
   * Mid-flow cancel for a single sub-order. Releases stock holds,
   * initiates a refund for prepaid orders, writes an audit log, and
   * updates the master order status (PARTIALLY_CANCELLED or
   * CANCELLED depending on the remaining sub-orders' state).
   *
   * Phase 81 (2026-05-22) — sub-order cancel audit Gaps #11/#12/#17/#18/#19.
   *   • DTO validates a required 10-500 char reason (Gaps #11/#12).
   *   • Dedicated `orders.subOrder.cancel` permission separates this
   *     from the master-order cancel + verify-reject paths (Gap #19).
   *   • `force: true` requires the additional
   *     `orders.subOrder.cancel.force` permission so SHIPPED /
   *     FULFILLED cancels aren't a default escalation path (Gap #8).
   *   • @Throttle caps loop-call DoS (Gap #18).
   *   • @Idempotent returns the same response shape on retry — admin
   *     double-tap can't trigger duplicate refunds (Gap #17).
   *   • req.adminId is threaded into the service so SubOrder.cancelledBy
   *     records the actor.
   */
  @Patch('sub-orders/:subOrderId/cancel')
  @Permissions('orders.subOrder.cancel')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Idempotent()
  async cancelSubOrder(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Body() body: CancelSubOrderDto,
  ) {
    if (body.force) {
      const perms: string[] = req?.user?.permissions ?? [];
      if (!perms.includes('orders.subOrder.cancel.force')) {
        throw new ForbiddenAppException(
          'force=true requires the orders.subOrder.cancel.force permission',
        );
      }
    }
    const adminId: string | undefined = req?.adminId ?? req?.userId;
    const data = await this.ordersService.adminCancelSubOrder(
      subOrderId,
      adminId as string,
      body.reason,
      { force: !!body.force },
    );
    return {
      success: true,
      message: 'Sub-order cancelled',
      data,
    };
  }
}
