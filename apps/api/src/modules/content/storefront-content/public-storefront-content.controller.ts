import { Public } from '@core/decorators';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StorefrontContentService } from './storefront-content.service';

/**
 * Public read of all active storefront content blocks. Returns a flat
 * map keyed by slot so the storefront's homepage can do a single
 * lookup per MediaTile.
 *
 * No auth — this is meant to be hit by the storefront server-side
 * fetch during page rendering. The data is non-sensitive (image URLs
 * and marketing copy that's already public on the homepage).
 */
@ApiTags('Storefront Content')
@Public()
@Controller('storefront/content')
export class PublicStorefrontContentController {
  constructor(private readonly service: StorefrontContentService) {}

  @Get()
  async list() {
    const map = await this.service.listActiveAsMap();
    return {
      success: true,
      message: 'Storefront content map',
      data: { blocks: map },
    };
  }
}
