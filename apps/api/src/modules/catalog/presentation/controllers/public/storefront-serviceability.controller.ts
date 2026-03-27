import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ServiceabilityService } from '../../../application/services/serviceability.service';
import { BadRequestAppException } from '../../../../../core/exceptions';

@ApiTags('Storefront')
@Controller('storefront/serviceability')
export class StorefrontServiceabilityController {
  constructor(
    private readonly serviceabilityService: ServiceabilityService,
  ) {}

  /**
   * Public endpoint — no auth required.
   * Check if a product/variant can be delivered to a pincode.
   *
   * GET /storefront/serviceability/check?productId=xxx&variantId=yyy&pincode=500001
   */
  @Get('check')
  @HttpCode(HttpStatus.OK)
  async checkServiceability(
    @Query('productId') productId?: string,
    @Query('variantId') variantId?: string,
    @Query('pincode') pincode?: string,
  ) {
    if (!productId) {
      throw new BadRequestAppException('productId query parameter is required');
    }
    if (!pincode) {
      throw new BadRequestAppException('pincode query parameter is required');
    }

    const result = await this.serviceabilityService.checkServiceability(
      productId,
      variantId || null,
      pincode,
    );

    return {
      success: true,
      message: result.serviceable
        ? 'Product is deliverable to this pincode'
        : 'Product is not deliverable to this pincode',
      data: {
        serviceable: result.serviceable,
        deliveryEstimate: result.deliveryEstimate,
        estimatedDays: result.estimatedDays,
        sellers: result.sellers.map((s) => ({
          sellerId: s.sellerId,
          sellerName: s.sellerName,
          distance: s.distance,
          dispatchSla: s.dispatchSla,
          stockQty: s.stockQty,
          estimatedDeliveryDays: s.estimatedDeliveryDays,
        })),
      },
    };
  }
}
