import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import { BadRequestAppException, NotFoundAppException } from '../../../../core/exceptions';
import { ShippingPublicFacade } from '../../application/facades/shipping-public.facade';

@ApiTags('Admin Shipping')
@Controller('admin/shipping')
@UseGuards(AdminAuthGuard)
export class AdminShippingController {
  constructor(private readonly facade: ShippingPublicFacade) {}

  /** Manually attach courier + AWB to a sub-order. */
  @Post('sub-orders/:subOrderId')
  async createShipment(
    @Param('subOrderId') subOrderId: string,
    @Body() body: { courierName?: string; awb?: string; trackingUrl?: string },
  ) {
    if (!body?.courierName && !body?.awb) {
      throw new BadRequestAppException('At least one of courierName or awb is required');
    }
    const data = await this.facade.createShipment(subOrderId, body);
    return { success: true, message: 'Shipment created', data };
  }

  @Get('sub-orders/:subOrderId')
  async getShipment(@Param('subOrderId') subOrderId: string) {
    const data = await this.facade.getShipmentBySubOrderId(subOrderId);
    if (!data) throw new NotFoundAppException('Shipment not found');
    return { success: true, message: 'Shipment', data };
  }

  @Get('sub-orders/:subOrderId/label')
  async getLabel(@Param('subOrderId') subOrderId: string) {
    const data = await this.facade.getLabelInfo(subOrderId);
    if (!data) throw new NotFoundAppException('Label info not found');
    return { success: true, message: 'Label info', data };
  }

  @Patch('sub-orders/:subOrderId/status')
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
  async getNdrRto(@Param('subOrderId') subOrderId: string) {
    const data = await this.facade.getNdrRtoState(subOrderId);
    if (!data) throw new NotFoundAppException('Sub-order not found');
    return { success: true, message: 'NDR/RTO state', data };
  }
}
