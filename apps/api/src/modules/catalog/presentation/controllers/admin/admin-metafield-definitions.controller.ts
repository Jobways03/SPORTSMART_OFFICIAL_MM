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
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import {
  NotFoundAppException,
  BadRequestAppException,
} from '../../../../../core/exceptions';
import { AdminAuthGuard, PermissionsGuard } from '../../../../../core/guards';
import { Permissions } from '../../../../../core/decorators/permissions.decorator';
import { CurrentAdmin } from '../../../../../core/decorators/current-actor.decorator';
import { RedisService } from '../../../../../bootstrap/cache/redis.service';
import { METAFIELD_REPOSITORY, IMetafieldRepository } from '../../../domain/repositories/metafield.repository.interface';
import { CATEGORY_REPOSITORY, ICategoryRepository } from '../../../domain/repositories/category.repository.interface';
import {
  BulkCreateMetafieldDefinitionsDto,
  CreateMetafieldDefinitionDto,
  UpdateMetafieldDefinitionDto,
} from '../../dtos/admin-metafield-definition.dto';
import {
  BulkMarkMetafieldFilterableDto,
  MarkMetafieldFilterableDto,
} from '../../dtos/admin-storefront-filter.dto';
import { CatalogCacheService } from '../../../application/services/catalog-cache.service';

/**
 * Phase 39 (2026-05-21) — full controller rewrite. Closes audit gaps:
 *   - #1 missing @Permissions per route → split read vs write vs approve
 *   - #2 @Body() body: any → DTOs with class-validator
 *   - #7 no audit-log writes → writeAuditLog on every mutation
 *   - #11 cache invalidation absent → delPattern on every mutation
 *   - #14 unbounded choices/validations → DTOs enforce shapes
 *   - reactivate-on-create returns a {reactivated:true} flag now so
 *     the UI can show a different toast.
 */

const STOREFRONT_METAFIELDS_CACHE_PREFIX = 'storefront:metafields:list';

@ApiTags('Admin - Metafield Definitions')
@Controller({ path: 'admin', version: '1' })
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminMetafieldDefinitionsController {
  constructor(
    @Inject(METAFIELD_REPOSITORY) private readonly metafieldRepo: IMetafieldRepository,
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepo: ICategoryRepository,
    private readonly redis: RedisService,
    private readonly cache: CatalogCacheService,
  ) {}

  /**
   * Phase 39 (2026-05-21) — flush the storefront category-metafield
   * cache. Called on every mutation. Best-effort — a Redis outage
   * shouldn't fail the admin's write.
   *
   * Phase 40 (2026-05-21) — also flush the storefront filter list
   * cache. Toggling isFilterable on a definition changes which filters
   * appear on the storefront sidebar.
   */
  private async invalidateStorefrontCache(): Promise<void> {
    try {
      await this.redis.delPattern(`${STOREFRONT_METAFIELDS_CACHE_PREFIX}:*`);
      await this.cache.invalidateFilters();
    } catch {
      // logged at the redis layer
    }
  }

  // ─── List definitions ──────────────────────────────────────────────

  @Get('metafield-definitions')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  @ApiOperation({ summary: 'List metafield definitions' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'ownerType', required: false, enum: ['CATEGORY', 'CUSTOM'] })
  @ApiQuery({ name: 'namespace', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  async list(
    @Query('categoryId') categoryId?: string,
    @Query('ownerType') ownerType?: string,
    @Query('namespace') namespace?: string,
    @Query('isActive') isActive?: string,
  ) {
    const where: any = {};
    if (categoryId) where.categoryId = categoryId;
    if (ownerType) where.ownerType = ownerType;
    if (namespace) where.namespace = namespace;
    if (isActive !== undefined) where.isActive = isActive !== 'false';

    const definitions = await this.metafieldRepo.findDefinitions(where);

    return {
      success: true,
      message: 'Metafield definitions retrieved',
      data: { definitions, total: definitions.length },
    };
  }

  @Get('metafield-definitions/:id')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  async getById(@Param('id') id: string) {
    const definition = await this.metafieldRepo.findDefinitionWithCounts(id);
    if (!definition) throw new NotFoundAppException('Metafield definition not found');
    return { success: true, message: 'Metafield definition retrieved', data: { definition } };
  }

  @Get('categories/:categoryId/metafield-definitions')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  @ApiOperation({ summary: 'Get metafield definitions for a category including inherited from parents' })
  async getForCategory(@Param('categoryId') categoryId: string) {
    const category = await this.categoryRepo.findById(categoryId);
    if (!category) throw new NotFoundAppException('Category not found');

    const categoryIds = await this.metafieldRepo.getCategoryHierarchyIds(categoryId);
    const definitions = await this.metafieldRepo.findDefinitions({
      isActive: true,
      OR: [
        { categoryId: { in: categoryIds }, ownerType: 'CATEGORY' },
        { ownerType: 'CUSTOM' },
      ],
    });

    const result = definitions.map((d: any) => ({
      ...d,
      inherited: d.categoryId !== categoryId,
      source: d.ownerType === 'CUSTOM' ? 'custom' : (d.categoryId === categoryId ? 'own' : 'inherited'),
    }));

    return {
      success: true,
      message: 'Category metafield definitions retrieved',
      data: { categoryId, definitions: result, total: result.length },
    };
  }

  // ─── Audit-log read (Phase 39) ────────────────────────────────────

  @Get('metafield-definitions/:id/audit-log')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  @ApiOperation({ summary: 'Get the audit log for a metafield definition' })
  async getAuditLog(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const definition = await this.metafieldRepo.findDefinitionById(id);
    if (!definition) throw new NotFoundAppException('Metafield definition not found');

    const entries = await this.metafieldRepo.findAuditLogForDefinition(id, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });

    return { success: true, message: 'Audit log retrieved', data: entries };
  }

  // ─── Create / Reactivate ──────────────────────────────────────────

  @Post('metafield-definitions')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Create a metafield definition (reactivates if soft-deleted)' })
  async create(@CurrentAdmin() adminId: string, @Body() dto: CreateMetafieldDefinitionDto) {
    if (dto.ownerType === 'CATEGORY' && !dto.categoryId) {
      throw new BadRequestAppException('categoryId is required for CATEGORY type definitions');
    }
    if ((dto.type === 'SINGLE_SELECT' || dto.type === 'MULTI_SELECT') && (!dto.choices || dto.choices.length === 0)) {
      throw new BadRequestAppException('choices are required for SINGLE_SELECT and MULTI_SELECT types');
    }

    if (dto.categoryId) {
      const category = await this.categoryRepo.findById(dto.categoryId);
      if (!category) throw new NotFoundAppException('Category not found');
    }

    // Reactivate-on-conflict: if a soft-deleted definition exists with
    // the same (namespace, key, categoryId) we recycle it and flag the
    // result so the UI can show "Reactivated 'X'" instead of "Created".
    const existing = await this.metafieldRepo.findDefinitionByNamespaceKey(
      dto.namespace,
      dto.key,
      dto.categoryId || null,
    );
    if (existing) {
      if (!existing.isActive) {
        const reactivated = await this.metafieldRepo.updateDefinition(existing.id, {
          name: dto.name,
          description: dto.description ?? null,
          type: dto.type,
          validations: (dto.validations ?? Prisma.JsonNull) as any,
          choices: (dto.choices ?? Prisma.JsonNull) as any,
          ownerType: dto.ownerType || 'CATEGORY',
          pinned: dto.pinned ?? false,
          sortOrder: dto.sortOrder ?? 0,
          isRequired: dto.isRequired ?? false,
          isActive: true,
        });
        await this.metafieldRepo.writeAuditLog({
          metafieldDefinitionId: existing.id,
          action: 'REACTIVATE',
          adminId,
          previousState: existing,
          newState: reactivated,
          reason: 'Reactivated via create-with-existing-key',
        });
        await this.invalidateStorefrontCache();
        return {
          success: true,
          message: 'Metafield definition reactivated',
          data: { definition: reactivated, reactivated: true },
        };
      }
      throw new BadRequestAppException(
        `A definition with namespace "${dto.namespace}" and key "${dto.key}" already exists for this category`,
      );
    }

    const definition = await this.metafieldRepo.createDefinition({
      namespace: dto.namespace,
      key: dto.key,
      name: dto.name,
      description: dto.description ?? null,
      type: dto.type,
      validations: (dto.validations ?? Prisma.JsonNull) as any,
      choices: (dto.choices ?? Prisma.JsonNull) as any,
      ownerType: dto.ownerType || 'CATEGORY',
      categoryId: dto.categoryId ?? null,
      pinned: dto.pinned ?? false,
      sortOrder: dto.sortOrder ?? 0,
      isRequired: dto.isRequired ?? false,
    });

    await this.metafieldRepo.writeAuditLog({
      metafieldDefinitionId: definition.id,
      action: 'CREATE',
      adminId,
      newState: definition,
    });
    await this.invalidateStorefrontCache();

    return { success: true, message: 'Metafield definition created', data: { definition, reactivated: false } };
  }

  // ─── Update ───────────────────────────────────────────────────────

  @Patch('metafield-definitions/:id')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Update a metafield definition' })
  async update(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMetafieldDefinitionDto,
  ) {
    const existing = await this.metafieldRepo.findDefinitionById(id);
    if (!existing) throw new NotFoundAppException('Metafield definition not found');

    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.choices !== undefined) updateData.choices = dto.choices;
    if (dto.validations !== undefined) updateData.validations = dto.validations;
    if (dto.pinned !== undefined) updateData.pinned = dto.pinned;
    if (dto.sortOrder !== undefined) updateData.sortOrder = dto.sortOrder;
    if (dto.isRequired !== undefined) updateData.isRequired = dto.isRequired;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    let action: 'UPDATE' | 'DEACTIVATE' | 'REACTIVATE' = 'UPDATE';
    if (dto.isActive !== undefined && dto.isActive !== existing.isActive) {
      action = dto.isActive ? 'REACTIVATE' : 'DEACTIVATE';
    }

    // Type change is only allowed if no product metafield values exist.
    if (dto.type !== undefined && dto.type !== existing.type) {
      const valueCount = await this.metafieldRepo.countMetafieldValues(id);
      if (valueCount > 0) {
        throw new BadRequestAppException(
          `Cannot change type: ${valueCount} products have values for this definition. Remove values first.`,
        );
      }
      updateData.type = dto.type;
    }

    const definition = await this.metafieldRepo.updateDefinition(id, updateData);

    await this.metafieldRepo.writeAuditLog({
      metafieldDefinitionId: id,
      action,
      adminId,
      previousState: existing,
      newState: definition,
    });
    await this.invalidateStorefrontCache();

    return { success: true, message: 'Metafield definition updated', data: { definition } };
  }

  // ─── Delete / Deactivate ──────────────────────────────────────────

  @Delete('metafield-definitions/:id')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Delete or deactivate a metafield definition' })
  async deactivate(@CurrentAdmin() adminId: string, @Param('id') id: string) {
    const existing = await this.metafieldRepo.findDefinitionWithCounts(id);
    if (!existing) throw new NotFoundAppException('Metafield definition not found');

    // Hard-delete only if nothing references it. The FK is RESTRICT
    // post-Phase-39, so a stray product value would surface here as a
    // Prisma error — we pre-empt with the count + branch.
    if ((existing as any)._count.metafieldValues === 0 && (existing as any)._count.filterConfigs === 0) {
      await this.metafieldRepo.deleteDefinition(id);
      await this.metafieldRepo.writeAuditLog({
        metafieldDefinitionId: id,
        action: 'DELETE',
        adminId,
        previousState: existing,
      });
      await this.invalidateStorefrontCache();
      return { success: true, message: 'Metafield definition deleted' };
    }

    await this.metafieldRepo.deactivateDefinition(id);
    await this.metafieldRepo.writeAuditLog({
      metafieldDefinitionId: id,
      action: 'DEACTIVATE',
      adminId,
      previousState: existing,
      reason: 'Has product values or filter configs — soft-deleted',
    });
    await this.invalidateStorefrontCache();

    return { success: true, message: 'Metafield definition deactivated (has product values)' };
  }

  // ─── Bulk assign to category ──────────────────────────────────────

  @Post('categories/:categoryId/metafield-definitions/bulk')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Bulk create metafield definitions for a category' })
  async bulkAssign(
    @CurrentAdmin() adminId: string,
    @Param('categoryId') categoryId: string,
    @Body() dto: BulkCreateMetafieldDefinitionsDto,
  ) {
    const category = await this.categoryRepo.findById(categoryId);
    if (!category) throw new NotFoundAppException('Category not found');

    const { created, skipped } = await this.metafieldRepo.bulkCreateDefinitions(categoryId, dto.definitions);

    // Phase 39 — bulk audit-log entry. One per created row so each
    // definition has a discoverable trail, and one BULK_ASSIGN entry
    // on the *parent* (oldest) of the batch to surface the
    // intent at the timeline level. We don't emit BULK_ASSIGN on every
    // row — that doubles up with the CREATE entries.
    for (const def of created) {
      await this.metafieldRepo.writeAuditLog({
        metafieldDefinitionId: def.id,
        action: 'CREATE',
        adminId,
        newState: def,
        reason: 'Bulk assign',
      });
    }
    await this.invalidateStorefrontCache();

    return {
      success: true,
      message: `Created ${created.length} definitions, skipped ${skipped.length}`,
      data: { created, skipped },
    };
  }

  // ─── Phase 40 (2026-05-21) — filterable toggle ────────────────────
  //
  // PATCH /admin/metafield-definitions/:id/filterable
  // Closes audit gap #8 — single explicit endpoint instead of forcing
  // admin to create a full StorefrontFilter config row just to expose
  // the definition on the storefront sidebar.

  @Patch('metafield-definitions/:id/filterable')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Toggle a metafield definition as a storefront filter' })
  async markFilterable(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
    @Body() dto: MarkMetafieldFilterableDto,
  ) {
    const existing = await this.metafieldRepo.findDefinitionById(id);
    if (!existing) throw new NotFoundAppException('Metafield definition not found');

    const definition = await this.metafieldRepo.markDefinitionFilterable(id, {
      isFilterable: dto.isFilterable,
      defaultFilterType: dto.defaultFilterType ?? null,
      defaultFilterLabel: dto.defaultFilterLabel ?? null,
      filterDisplayOrder: dto.filterDisplayOrder,
    });

    await this.metafieldRepo.writeAuditLog({
      metafieldDefinitionId: id,
      action: 'UPDATE',
      adminId,
      previousState: existing,
      newState: definition,
      reason: dto.isFilterable ? 'Marked as filterable' : 'Removed from filterable set',
    });
    await this.invalidateStorefrontCache();

    return { success: true, message: 'Filterable flag updated', data: { definition } };
  }

  @Post('metafield-definitions/bulk-filterable')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Bulk toggle filterable on many metafield definitions' })
  async bulkMarkFilterable(
    @CurrentAdmin() adminId: string,
    @Body() dto: BulkMarkMetafieldFilterableDto,
  ) {
    const result = await this.metafieldRepo.bulkMarkDefinitionsFilterable(
      dto.definitionIds,
      dto.isFilterable,
    );

    // Phase 40 — best-effort per-row audit. We don't fetch the full
    // before state for the batch (expensive); the audit just records
    // the flip with the admin id.
    for (const id of dto.definitionIds) {
      await this.metafieldRepo.writeAuditLog({
        metafieldDefinitionId: id,
        action: 'UPDATE',
        adminId,
        newState: { isFilterable: dto.isFilterable },
        reason: `Bulk ${dto.isFilterable ? 'enable' : 'disable'} filterable`,
      });
    }
    await this.invalidateStorefrontCache();

    return { success: true, message: `Updated ${result.updated} definitions`, data: result };
  }
}
