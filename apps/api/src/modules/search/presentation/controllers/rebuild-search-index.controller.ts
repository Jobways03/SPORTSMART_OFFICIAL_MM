import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { SearchPublicFacade } from '../../application/facades/search-public.facade';

@ApiTags('Search')
@Controller()
export class SearchExtraController {
  constructor(private readonly facade: SearchPublicFacade) {}

  /** Public typeahead — already wired in the storefront navbar. */
  @Get('storefront/products/search-suggestions')
  async suggest(@Query('q') q: string) {
    const data = await this.facade.suggest(q ?? '');
    return { success: true, message: 'Suggestions', data: { suggestions: data } };
  }

  /** Admin-only index rebuild trigger. */
  @Post('admin/search/reindex')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  async reindex() {
    await this.facade.rebuildSearchIndex();
    return { success: true, message: 'Reindex queued' };
  }
}
