import { Public } from '@core/decorators';
import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MarketingService } from './marketing.service';

// Public read of the active flash-sale campaigns. The storefront only
// renders the soonest-ending one, but we return the full set so a
// future "all deals" page can paginate without a second endpoint.
@ApiTags('Storefront Flash Sales')
@Public()
@Controller('storefront/flash-sales')
export class PublicFlashSalesController {
  constructor(private readonly service: MarketingService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list() {
    const sales = await this.service.listActiveFlashSales();
    return {
      success: true,
      message: 'Active flash sales',
      data: { sales },
    };
  }
}
