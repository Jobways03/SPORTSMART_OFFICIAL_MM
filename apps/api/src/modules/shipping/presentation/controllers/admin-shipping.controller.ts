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
}
