import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StorefrontMenuService } from '../../services/menu.service';

/**
 * Phase 48 (2026-05-21) — public menu read.
 *
 * Changes:
 *   - Returns the reduced PublicMenuTree shape (no internal linkType /
 *     linkRef / position). The storefront only needs the computed
 *     href + rendering hints.
 *   - 60s Redis cache, invalidated on every admin write that affects
 *     the menu (service-level, see invalidateMenuCacheByHandle).
 *   - Inactive items + inactive parents' descendants are filtered
 *     out at the service layer.
 */
@ApiTags('Storefront — Menus')
@Controller('storefront/menus')
export class PublicMenusController {
  constructor(private readonly service: StorefrontMenuService) {}

  @Get(':handle')
  async getByHandle(@Param('handle') handle: string) {
    return this.service.getPublicMenuByHandle(handle);
  }
}
