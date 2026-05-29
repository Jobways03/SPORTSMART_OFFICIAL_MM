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
import { AdminAuthGuard, PermissionsGuard } from '../../../../../core/guards';
import { Permissions } from '../../../../../core/decorators/permissions.decorator';
import { CatalogCacheService } from '../../../application/services/catalog-cache.service';
import { STOREFRONT_REPOSITORY, IStorefrontRepository } from '../../../domain/repositories/storefront.repository.interface';
import { METAFIELD_REPOSITORY, IMetafieldRepository } from '../../../domain/repositories/metafield.repository.interface';
import { CATEGORY_REPOSITORY, ICategoryRepository } from '../../../domain/repositories/category.repository.interface';
import { COLLECTION_REPOSITORY, ICollectionRepository } from '../../../domain/repositories/collection.repository.interface';
import {
  CreateStorefrontFilterDto,
  UpdateStorefrontFilterDto,
  ReorderStorefrontFiltersDto,
  VALID_SCOPE_TYPES,
} from '../../dtos/admin-storefront-filter.dto';

/**
 * Phase 40 (2026-05-21) — full rewrite to close audit gaps:
 *   #1  Granular @Permissions (catalog.read on GETs, catalog.write on
 *       mutations) — pre-Phase-40 the class-level @Permissions('storefront.write')
 *       forced every reader to hold the write scope.
 *   #2  @Patch('reorder') declared ABOVE @Patch(':id'). NestJS first-
 *       matches in declaration order; without this swap PATCH /reorder
 *       hits the :id handler and returns 404.
 *   #4  DTOs replace @Body() body: any (CreateStorefrontFilterDto /
 *       UpdateStorefrontFilterDto / ReorderStorefrontFiltersDto).
 *   #9  scopeId is validated against the right table (Category /
 *       Collection) per scopeType before write.
 *   #12 Every mutation invalidates the storefront filter cache so a
 *       sidebar refresh sees the new config immediately.
 */

@ApiTags('Admin - Storefront Filters')
@Controller({ path: 'admin/storefront-filters', version: '1' })
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminStorefrontFiltersController {
  constructor(
    @Inject(STOREFRONT_REPOSITORY) private readonly storefrontRepo: IStorefrontRepository,
    @Inject(METAFIELD_REPOSITORY) private readonly metafieldRepo: IMetafieldRepository,
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepo: ICategoryRepository,
    @Inject(COLLECTION_REPOSITORY) private readonly collectionRepo: ICollectionRepository,
    private readonly cache: CatalogCacheService,
  ) {}

  /**
   * Phase 40 — flush the storefront filter cache. Best-effort: a Redis
   * outage shouldn't fail the admin's mutation.
   */
  private async invalidateFilterCache(): Promise<void> {
    try {
      await this.cache.invalidateFilters();
    } catch {
      // logged at the cache layer
    }
  }

  /**
   * Phase 40 — validate that scopeId references a real row in the
   * relevant table when scopeType is non-GLOBAL.
   */
  private async assertScopeValid(scopeType?: string, scopeId?: string | null): Promise<void> {
    const effective = scopeType ?? 'GLOBAL';
    if (effective === 'GLOBAL') {
      // GLOBAL allows scopeId to be present but is ignored. Don't reject — caller may pass null.
      return;
    }
    if (!scopeId) {
      throw new BadRequestAppException(`scopeId is required when scopeType=${effective}`);
    }
    if (effective === 'CATEGORY') {
      const cat = await this.categoryRepo.findById(scopeId);
      if (!cat) throw new NotFoundAppException(`Category ${scopeId} not found`);
    } else if (effective === 'COLLECTION') {
      const col = await this.collectionRepo.findById(scopeId);
      if (!col) throw new NotFoundAppException(`Collection ${scopeId} not found`);
    }
  }

  // ─── List ──────────────────────────────────────────────────────────

  @Get()
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  @ApiOperation({ summary: 'List all storefront filter configurations' })
  async list(
    @Query('scopeType') scopeType?: string,
    @Query('scopeId') scopeId?: string,
    @Query('isActive') isActive?: string,
  ) {
    const where: any = {};
    if (scopeType) {
      if (!(VALID_SCOPE_TYPES as readonly string[]).includes(scopeType)) {
        throw new BadRequestAppException(`scopeType must be one of: ${VALID_SCOPE_TYPES.join(', ')}`);
      }
      where.scopeType = scopeType;
    }
    if (scopeId) where.scopeId = scopeId;
    if (isActive !== undefined) where.isActive = isActive !== 'false';

    const filters = await this.storefrontRepo.findFilterConfigs(where);
    return {
      success: true,
      message: 'Storefront filters retrieved',
      data: { filters, total: filters.length },
    };
  }

  // ─── Reorder (declared BEFORE :id to fix Gap #2) ────────────────────

  @Patch('reorder')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Reorder storefront filters' })
  async reorder(@Body() dto: ReorderStorefrontFiltersDto) {
    const { updated } = await this.storefrontRepo.reorderFilterConfigs(dto.ids);
    await this.invalidateFilterCache();
    return { success: true, message: `Reordered ${updated} filters`, data: { updated } };
  }

  // ─── Create ────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Create a storefront filter configuration' })
  async create(@Body() dto: CreateStorefrontFilterDto) {
    // Exactly one of metafieldDefinitionId or builtInType must be set.
    if (!dto.metafieldDefinitionId && !dto.builtInType) {
      throw new BadRequestAppException('Either metafieldDefinitionId or builtInType is required');
    }
    if (dto.metafieldDefinitionId && dto.builtInType) {
      throw new BadRequestAppException('metafieldDefinitionId and builtInType are mutually exclusive');
    }

    if (dto.metafieldDefinitionId) {
      const def = await this.metafieldRepo.findDefinitionById(dto.metafieldDefinitionId);
      if (!def) throw new NotFoundAppException('Metafield definition not found');
    }

    await this.assertScopeValid(dto.scopeType, dto.scopeId);

    const filter = await this.storefrontRepo.createFilterConfig({
      metafieldDefinitionId: dto.metafieldDefinitionId || null,
      builtInType: dto.builtInType || null,
      label: dto.label,
      filterType: dto.filterType,
      sortOrder: dto.sortOrder ?? 0,
      scopeType: dto.scopeType || 'GLOBAL',
      scopeId: dto.scopeId || null,
      collapsed: dto.collapsed ?? false,
      showCounts: dto.showCounts ?? true,
    });

    await this.invalidateFilterCache();
    return { success: true, message: 'Storefront filter created', data: { filter } };
  }

  // ─── Update ───────────────────────────────────────────────────────

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  async update(@Param('id') id: string, @Body() dto: UpdateStorefrontFilterDto) {
    const existing = await this.storefrontRepo.findFilterConfigById(id);
    if (!existing) throw new NotFoundAppException('Storefront filter not found');

    // If scope is being changed, validate the new combination.
    if (dto.scopeType !== undefined || dto.scopeId !== undefined) {
      const effectiveType = dto.scopeType ?? existing.scopeType;
      const effectiveId = dto.scopeId !== undefined ? dto.scopeId : existing.scopeId;
      await this.assertScopeValid(effectiveType, effectiveId);
    }

    const updateData: Partial<UpdateStorefrontFilterDto> = {};
    if (dto.label !== undefined) updateData.label = dto.label;
    if (dto.filterType !== undefined) updateData.filterType = dto.filterType;
    if (dto.sortOrder !== undefined) updateData.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.collapsed !== undefined) updateData.collapsed = dto.collapsed;
    if (dto.showCounts !== undefined) updateData.showCounts = dto.showCounts;
    if (dto.scopeType !== undefined) updateData.scopeType = dto.scopeType;
    if (dto.scopeId !== undefined) updateData.scopeId = dto.scopeId;

    const filter = await this.storefrontRepo.updateFilterConfig(id, updateData as any);
    await this.invalidateFilterCache();
    return { success: true, message: 'Storefront filter updated', data: { filter } };
  }

  // ─── Delete ───────────────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  async remove(@Param('id') id: string) {
    const existing = await this.storefrontRepo.findFilterConfigById(id);
    if (!existing) throw new NotFoundAppException('Storefront filter not found');

    await this.storefrontRepo.deleteFilterConfig(id);
    await this.invalidateFilterCache();
    return { success: true, message: 'Storefront filter deleted' };
  }
}
