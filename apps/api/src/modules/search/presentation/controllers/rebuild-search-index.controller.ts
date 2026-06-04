import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { SearchPublicFacade } from '../../application/facades/search-public.facade';

/**
 * Phase 195:
 *   #3 — the public `storefront/products/search-suggestions` route used to
 *        live here too, colliding with StorefrontProductsController's
 *        (catalog) handler of the same path. The catalog one is the live,
 *        @Throttle'd, moderation-gated implementation, so the duplicate was
 *        removed here. This controller is now admin-reindex only.
 *   #13 — reindex is async (202 + single-instance lock) instead of blocking
 *        the request for minutes on a 50K-product walk.
 */
@ApiTags('Search')
@Controller()
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('catalog.write')
export class SearchExtraController {
  constructor(private readonly facade: SearchPublicFacade) {}

  /** Admin-only index rebuild trigger — non-blocking. */
  @Post('admin/search/reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @ApiOperation({ summary: 'Trigger an async OpenSearch reindex (202)' })
  async reindex() {
    const outcome = this.facade.triggerReindex();
    return {
      success: true,
      message: outcome.started ? 'Reindex started' : outcome.reason ?? 'Reindex not started',
      data: { started: outcome.started },
    };
  }
}
