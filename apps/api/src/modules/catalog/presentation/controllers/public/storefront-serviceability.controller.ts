import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ServiceabilityService } from '../../../application/services/serviceability.service';
import { CheckServiceabilityQueryDto } from '../../dtos/storefront-allocation.dto';

/**
 * Phase 64 (2026-05-22) — PDP serviceability check.
 *
 * Pre-Phase-64:
 *   - No rate limit on this public surface — competitors could
 *     enumerate every product's seller distribution + warehouses
 *     by scraping (audit Gap #2).
 *   - Response carried sellerId, sellerName, mappingId, distance,
 *     stockQty — too much internal detail for an unauthenticated
 *     caller.
 *   - Query parameters were unbounded strings, so a garbage
 *     pincode `abc123` slipped through to the allocator and
 *     produced bizarre "serviceable at 999km" results (audit Gap
 *     #19 surface here).
 *
 * Phase 64 closes all three:
 *   - @Throttle({ limit: 60, ttl: 60_000 }) caps the per-IP burst.
 *   - The response is now a sanitised aggregate — count of
 *     fulfillment nodes + best-case delivery estimate. No
 *     sellerId / mappingId / per-seller stock.
 *   - DTO with @Matches PIN regex rejects malformed input at the
 *     pipe layer.
 */
@ApiTags('Storefront')
@Controller('storefront/serviceability')
export class StorefrontServiceabilityController {
  constructor(
    private readonly serviceabilityService: ServiceabilityService,
  ) {}

  @Get('check')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async checkServiceability(@Query() query: CheckServiceabilityQueryDto) {
    const result = await this.serviceabilityService.checkServiceability(
      query.productId,
      query.variantId || null,
      query.pincode,
    );

    // Phase 64 (audit Gap #2) — sanitise. Anonymous callers get
    // only the customer-facing answer: serviceable + estimated
    // delivery + how many fulfilment options exist. The internal
    // detail (sellerId, mappingId, distance, stockQty) stays
    // behind authenticated paths.
    return {
      success: true,
      message: result.serviceable
        ? 'Product is deliverable to this pincode'
        : 'Product is not deliverable to this pincode',
      data: {
        serviceable: result.serviceable,
        deliveryEstimate: result.deliveryEstimate,
        estimatedDays: result.estimatedDays,
        // Counts only; no per-fulfilment-node identifiers.
        fulfillmentOptions:
          result.sellers.length + result.franchises.length,
      },
    };
  }
}
