import { Public } from '@core/decorators';
import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { DelhiveryToolsService } from '../../application/services/delhivery-tools.service';

/**
 * Phase 4 Delhivery wiring (2026-06-02) — PUBLIC delivery-availability check
 * for the storefront. No auth (customers check a pincode before logging in,
 * on the product page / checkout). Rate-limited because it hits Delhivery's
 * live serviceability API. Returns a trimmed, customer-safe shape.
 */
@ApiTags('Delivery (public)')
@Public()
@Controller('delivery')
export class PublicDeliveryController {
  constructor(private readonly tools: DelhiveryToolsService) {}

  @Get('serviceability/:pincode')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async serviceability(@Param('pincode') pincode: string) {
    const data: any = await this.tools.serviceability(pincode);
    return {
      success: true,
      data: {
        pincode: data?.pincode ?? pincode,
        serviceable: !!data?.serviceable,
        codAvailable: !!data?.codAvailable,
        prepaidAvailable: !!data?.prepaidAvailable,
      },
    };
  }
}
