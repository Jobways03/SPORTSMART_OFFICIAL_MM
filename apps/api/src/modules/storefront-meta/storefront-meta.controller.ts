import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StorefrontMetaService } from './storefront-meta.service';

// Public meta surface — stats, config, store summary. No auth, no
// rate limiting beyond the global default. These power HomeScreen
// rails on mobile / web. All responses wrap in the standard
// {success, message, data} envelope to match the rest of the
// storefront API.
@ApiTags('Storefront Meta')
@Controller('storefront')
export class StorefrontMetaController {
  constructor(private readonly service: StorefrontMetaService) {}

  @Get('stats')
  @HttpCode(HttpStatus.OK)
  async getStats() {
    const data = await this.service.getStats();
    return { success: true, message: 'Storefront stats', data };
  }

  @Get('config')
  @HttpCode(HttpStatus.OK)
  getConfig() {
    const data = this.service.getConfig();
    return { success: true, message: 'Storefront config', data };
  }

  @Get('stores/summary')
  @HttpCode(HttpStatus.OK)
  async getStoresSummary() {
    const data = await this.service.getStoresSummary();
    return { success: true, message: 'Stores summary', data };
  }

  // Phase 8 — public product feed for sitemap.xml generation. Capped so a
  // crafted ?limit can't request an unbounded scan; the storefront asks for
  // 10000. Best-effort, no auth, standard {success,message,data} envelope.
  @Get('sitemap/products')
  @HttpCode(HttpStatus.OK)
  async getSitemapProducts(@Query('limit') limit?: string) {
    const parsed = parseInt(limit ?? '', 10);
    const n = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50000) : 10000;
    const data = await this.service.getSitemapProducts(n);
    return { success: true, message: 'Sitemap products', data };
  }
}
