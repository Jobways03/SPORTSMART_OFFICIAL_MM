import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StorefrontSlotsService } from './storefront-slots.service';

@ApiTags('Storefront Slots')
@Controller('storefront/slots')
export class PublicStorefrontSlotsController {
  constructor(private readonly service: StorefrontSlotsService) {}

  @Get()
  async list() {
    return {
      success: true,
      message: 'Storefront slot definitions',
      data: { items: await this.service.list() },
    };
  }
}
