import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { ShippingPublicFacade } from '../../application/facades/shipping-public.facade';
import { AttachAwbDto } from '../dtos/attach-awb.dto';

@ApiTags('Admin Shipping')
@Controller('admin/shipping')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminShippingController {
  constructor(private readonly facade: ShippingPublicFacade) {}

  /**
   * Manually attach courier + AWB to a sub-order.
   *
   * Phase 85 (2026-05-23) — manual AWB attachment audit. Closes
   * Gaps #1/#9/#10/#14/#15/#16/#19/#23 (controller-side):
   *   • Dedicated `orders.ship.manual` permission (was the
   *     mis-scoped `shipping.write` that conflated ShippingOption
   *     config with order-side AWB writes).
   *   • DTO validates AWB regex + courier enum + URL protocol;
   *     both courier AND awb required (no longer "at least one")
   *     because the SHIPPED transition needs the full pair.
   *   • @Idempotent absorbs double-clicks.
   *   • @Throttle caps misbehaving admin bots.
   *   • req.adminId threaded to the facade so the SubOrder row +
   *     audit log + AWB-history row all record the actor.
   */
  @Post('sub-orders/:subOrderId')
  @Permissions('orders.ship.manual')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async createShipment(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Body() body: AttachAwbDto,
  ) {
    const adminId: string | undefined = req?.adminId ?? req?.userId;
    const data = await this.facade.attachAwb(subOrderId, body, adminId);
    return { success: true, message: 'Shipment attached', data };
  }

  @Get('sub-orders/:subOrderId')
  @Permissions('orders.read')
  async getShipment(@Param('subOrderId') subOrderId: string) {
    const data = await this.facade.getShipmentBySubOrderId(subOrderId);
    if (!data) throw new NotFoundAppException('Shipment not found');
    return { success: true, message: 'Shipment', data };
  }

  @Get('sub-orders/:subOrderId/label')
  @Permissions('orders.read')
  async getLabel(@Param('subOrderId') subOrderId: string) {
    const data = await this.facade.getLabelInfo(subOrderId);
    if (!data) throw new NotFoundAppException('Label info not found');
    return { success: true, message: 'Label info', data };
  }

  // Phase 85 — Gap #22. Tracking-event status updates use the same
  // permission as the AWB attach because they share the SHIPPED FSM
  // surface and trigger the same downstream effects.
  @Patch('sub-orders/:subOrderId/status')
  @Permissions('orders.ship.manual')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async updateStatus(
    @Param('subOrderId') subOrderId: string,
    @Body() body: { status: string; location?: string },
  ) {
    if (!body?.status) {
      throw new BadRequestAppException('status is required');
    }
    await this.facade.updateShipmentFromTrackingEvent(subOrderId, {
      status: body.status,
      location: body.location,
    });
    return { success: true, message: 'Status updated' };
  }

  @Get('sub-orders/:subOrderId/ndr-rto')
  @Permissions('orders.read')
  async getNdrRto(@Param('subOrderId') subOrderId: string) {
    const data = await this.facade.getNdrRtoState(subOrderId);
    if (!data) throw new NotFoundAppException('Sub-order not found');
    return { success: true, message: 'NDR/RTO state', data };
  }

  /**
   * Phase 3 Delhivery wiring (2026-06-02) — cancel the courier shipment at
   * the carrier (distinct from the order-level cancel/refund saga). Calls the
   * Delhivery adapter via the resolver; best-effort (returns the outcome).
   */
  @Post('sub-orders/:subOrderId/courier-cancel')
  @Permissions('orders.ship.manual')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async courierCancel(@Param('subOrderId') subOrderId: string) {
    const data = await this.facade.cancelCourierShipment(subOrderId);
    return { success: data.success, message: data.message, data };
  }

  /**
   * Phase 3 Delhivery wiring — pull a fresh tracking snapshot from the
   * carrier on demand and ingest it (source MANUAL_ADMIN). Mutating, so POST.
   */
  @Post('sub-orders/:subOrderId/track-refresh')
  @Permissions('orders.ship.manual')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async trackRefresh(@Param('subOrderId') subOrderId: string) {
    const data = await this.facade.refreshTracking(subOrderId);
    return { success: true, message: data.message, data };
  }

  /**
   * Phase 90 (2026-06-03) — per-order self-service pickup. Resolves the
   * sub-order's seller/franchise registered Delhivery warehouse and raises ONE
   * pickup for it (idempotent per warehouse+day, so it never double-books).
   * Lets sellers / retailer / franchise schedule their own pickup without
   * going through the Super Admin.
   */
  @Post('sub-orders/:subOrderId/request-pickup')
  @Permissions('orders.ship.manual')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async requestPickup(@Param('subOrderId') subOrderId: string) {
    const data = await this.facade.requestPickupForSubOrder(subOrderId);
    return { success: data.success, message: data.message, data };
  }

  /**
   * Phase 91 (2026-06-03) — Delhivery-FIRST cancel. Cancels the Delhivery
   * shipment first and, ONLY on carrier confirmation, cancels the order via the
   * existing adminCancelSubOrder. If the carrier can't cancel (parcel picked
   * up), it blocks (409) and the caller is told to use Force RTO. Both admin
   * cancel buttons route here so the order + Delhivery stay in sync.
   */
  @Post('sub-orders/:subOrderId/cancel-with-courier')
  @Permissions('orders.ship.manual')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Idempotent()
  async cancelWithCourier(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Body() body: { reason: string; force?: boolean },
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
    const data = await this.facade.cancelOrderWithCourierFirst(
      subOrderId,
      adminId,
      body.reason,
      !!body.force,
    );
    return { success: true, message: data.message, data };
  }
}
