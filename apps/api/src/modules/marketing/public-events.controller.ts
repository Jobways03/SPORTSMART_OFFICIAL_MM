import { Public } from '@core/decorators';
import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MarketingService } from './marketing.service';

// Public read of upcoming sport events. Returns up to 10, sorted by
// startsAt ascending; mobile shows the first 3 on HomeScreen.
@ApiTags('Storefront Events')
@Public()
@Controller('storefront/events')
export class PublicEventsController {
  constructor(private readonly service: MarketingService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list() {
    const events = await this.service.listUpcomingEvents();
    return {
      success: true,
      message: 'Upcoming events',
      data: { events },
    };
  }
}
