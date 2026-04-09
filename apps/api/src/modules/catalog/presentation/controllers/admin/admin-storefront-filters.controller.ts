import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  NotFoundAppException,
  BadRequestAppException,
} from '../../../../../core/exceptions';
import { AdminAuthGuard } from '../../../../../core/guards';
import { STOREFRONT_REPOSITORY, IStorefrontRepository } from '../../../domain/repositories/storefront.repository.interface';
import { METAFIELD_REPOSITORY, IMetafieldRepository } from '../../../domain/repositories/metafield.repository.interface';

const VALID_FILTER_TYPES = ['checkbox', 'price_range', 'boolean_toggle', 'color_swatch', 'text_input'] as const;
const VALID_BUILT_IN_TYPES = ['price_range', 'brand', 'availability', 'variant_option'] as const;
const VALID_SCOPE_TYPES = ['GLOBAL', 'CATEGORY', 'COLLECTION'] as const;

@ApiTags('Admin - Storefront Filters')
@Controller({ path: 'admin/storefront-filters', version: '1' })
@UseGuards(AdminAuthGuard)
export class AdminStorefrontFiltersController {
  constructor(
    @Inject(STOREFRONT_REPOSITORY) private readonly storefrontRepo: IStorefrontRepository,
    @Inject(METAFIELD_REPOSITORY) private readonly metafieldRepo: IMetafieldRepository,
  ) {}

  // ─── List all filter configs ──────────────────────────────────────

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all storefront filter configurations' })
  async list(
    @Query('scopeType') scopeType?: string,
    @Query('scopeId') scopeId?: string,
    @Query('isActive') isActive?: string,
  ) {
    const where: any = {};
    if (scopeType) where.scopeType = scopeType;
    if (scopeId) where.scopeId = scopeId;
    if (isActive !== undefined) where.isActive = isActive !== 'false';

    const filters = await this.storefrontRepo.findFilterConfigs(where);

    return {
      success: true,
      message: 'Storefront filters retrieved',
      data: { filters, total: filters.length },
    };
  }

  // ─── Create filter config ────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a storefront filter configuration' })
  async create(@Body() body: any) {
    const { metafieldDefinitionId, builtInType, label, filterType, sortOrder, scopeType, scopeId, collapsed, showCounts } = body;

    if (!label) throw new BadRequestAppException('label is required');
    if (!filterType || !VALID_FILTER_TYPES.includes(filterType)) {
      throw new BadRequestAppException(`filterType must be one of: ${VALID_FILTER_TYPES.join(', ')}`);
    }

    // Must have either metafieldDefinitionId or builtInType
    if (!metafieldDefinitionId && !builtInType) {
      throw new BadRequestAppException('Either metafieldDefinitionId or builtInType is required');
    }

    if (builtInType && !VALID_BUILT_IN_TYPES.includes(builtInType)) {
      throw new BadRequestAppException(`builtInType must be one of: ${VALID_BUILT_IN_TYPES.join(', ')}`);
    }

    if (scopeType && !VALID_SCOPE_TYPES.includes(scopeType)) {
      throw new BadRequestAppException(`scopeType must be one of: ${VALID_SCOPE_TYPES.join(', ')}`);
    }

    if (metafieldDefinitionId) {
      const def = await this.metafieldRepo.findDefinitionById(metafieldDefinitionId);
      if (!def) throw new NotFoundAppException('Metafield definition not found');
    }

    const filter = await this.storefrontRepo.createFilterConfig({
      metafieldDefinitionId: metafieldDefinitionId || null,
      builtInType: builtInType || null,
      label,
      filterType,
      sortOrder: sortOrder ?? 0,
      scopeType: scopeType || 'GLOBAL',
      scopeId: scopeId || null,
      collapsed: collapsed ?? false,
      showCounts: showCounts ?? true,
    });

    return { success: true, message: 'Storefront filter created', data: { filter } };
  }

  // ─── Update filter config ────────────────────────────────────────

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() body: any) {
    const existing = await this.storefrontRepo.findFilterConfigById(id);
    if (!existing) throw new NotFoundAppException('Storefront filter not found');

    const updateData: any = {};
    if (body.label !== undefined) updateData.label = body.label;
    if (body.filterType !== undefined) {
      if (!VALID_FILTER_TYPES.includes(body.filterType)) {
        throw new BadRequestAppException(`filterType must be one of: ${VALID_FILTER_TYPES.join(', ')}`);
      }
      updateData.filterType = body.filterType;
    }
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.collapsed !== undefined) updateData.collapsed = body.collapsed;
    if (body.showCounts !== undefined) updateData.showCounts = body.showCounts;
    if (body.scopeType !== undefined) updateData.scopeType = body.scopeType;
    if (body.scopeId !== undefined) updateData.scopeId = body.scopeId;

    const filter = await this.storefrontRepo.updateFilterConfig(id, updateData);

    return { success: true, message: 'Storefront filter updated', data: { filter } };
  }

  // ─── Delete filter config ────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    const existing = await this.storefrontRepo.findFilterConfigById(id);
    if (!existing) throw new NotFoundAppException('Storefront filter not found');

    await this.storefrontRepo.deleteFilterConfig(id);

    return { success: true, message: 'Storefront filter deleted' };
  }

  // ─── Bulk reorder ────────────────────────────────────────────────

  @Patch('reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reorder storefront filters' })
  async reorder(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids)) {
      throw new BadRequestAppException('ids array is required');
    }

    await this.storefrontRepo.reorderFilterConfigs(body.ids);

    return { success: true, message: 'Filters reordered' };
  }
}
