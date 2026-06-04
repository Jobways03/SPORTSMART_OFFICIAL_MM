import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { DelhiveryToolsService } from '../../application/services/delhivery-tools.service';

/**
 * Phase 4 Delhivery wiring (2026-06-02) — admin surface for the Delhivery
 * "tools" capabilities, shared by all four admin panels (Super/Seller/
 * Retail/Franchise — they all authenticate with the platform admin JWT).
 * Read-style lookups use `orders.read`; carrier-mutating actions use
 * `orders.ship.manual`.
 */
@ApiTags('Admin Delhivery')
@Controller('admin/delhivery')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminDelhiveryController {
  constructor(private readonly tools: DelhiveryToolsService) {}

  @Get('serviceability/:pincode')
  @Permissions('orders.read')
  async serviceability(@Param('pincode') pincode: string) {
    const data = await this.tools.serviceability(pincode);
    return { success: true, message: 'Serviceability', data };
  }

  @Get('serviceability/:pincode/heavy')
  @Permissions('orders.read')
  async heavyServiceability(@Param('pincode') pincode: string) {
    const data = await this.tools.heavyServiceability(pincode);
    return { success: true, message: 'Heavy serviceability', data };
  }

  @Get('tat')
  @Permissions('orders.read')
  async expectedTat(
    @Query('origin') origin: string,
    @Query('destination') destination: string,
    @Query('mot') mot?: string,
    @Query('productType') productType?: string,
    @Query('expectedPickupDate') expectedPickupDate?: string,
  ) {
    const data = await this.tools.expectedTat({
      origin,
      destination,
      mot,
      productType,
      expectedPickupDate,
    });
    return { success: true, message: 'Expected TAT', data };
  }

  @Get('cost')
  @Permissions('orders.read')
  async cost(
    @Query('weightGrams') weightGrams: string,
    @Query('origin') origin: string,
    @Query('destination') destination: string,
    @Query('mode') mode?: string,
    @Query('paymentType') paymentType?: string,
    @Query('lengthCm') lengthCm?: string,
    @Query('breadthCm') breadthCm?: string,
    @Query('heightCm') heightCm?: string,
  ) {
    const data = await this.tools.calculateCost({
      weightGrams: Number(weightGrams),
      origin,
      destination,
      mode,
      paymentType,
      lengthCm: lengthCm ? Number(lengthCm) : undefined,
      breadthCm: breadthCm ? Number(breadthCm) : undefined,
      heightCm: heightCm ? Number(heightCm) : undefined,
    });
    return { success: true, message: 'Shipping cost', data };
  }

  @Get('waybill')
  @Permissions('orders.ship.manual')
  async waybill(@Query('count') count?: string) {
    const data = await this.tools.fetchWaybills(Number(count) || 1);
    return { success: true, message: 'Waybills', data };
  }

  @Post('pickup')
  @Permissions('orders.ship.manual')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async pickup(
    @Body()
    body: {
      warehouseName: string;
      date: string;
      time: string;
      expectedPackageCount: number;
    },
  ) {
    const data = await this.tools.raisePickup(body);
    return { success: true, message: 'Pickup requested', data };
  }

  @Post('shipments/:awb/edit')
  @Permissions('orders.ship.manual')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async edit(
    @Param('awb') awb: string,
    @Body() changes: Record<string, unknown>,
  ) {
    const data = await this.tools.editShipment(awb, changes);
    return { success: true, message: 'Shipment updated', data };
  }

  @Post('shipments/:awb/ewaybill')
  @Permissions('orders.ship.manual')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async ewaybill(
    @Param('awb') awb: string,
    @Body() body: { dcn: string; ewbn: string },
  ) {
    const data = await this.tools.updateEwaybill(awb, body.dcn, body.ewbn);
    return { success: true, message: 'E-waybill updated', data };
  }
}
