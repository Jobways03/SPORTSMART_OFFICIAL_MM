import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../../core/exceptions';
import { AdminAuthGuard, PermissionsGuard } from '../../../../../core/guards';
import { Permissions } from '../../../../../core/decorators/permissions.decorator';
import { CurrentAdmin } from '../../../../../core/decorators/current-actor.decorator';
import { MediaStorageAdapter } from '../../../../../integrations/media/media-storage.adapter';
import { RedisService } from '../../../../../bootstrap/cache/redis.service';
import { CATEGORY_REPOSITORY, ICategoryRepository } from '../../../domain/repositories/category.repository.interface';
import { AdminCreateCategoryDto } from '../../dtos/admin-create-category.dto';
import { AdminUpdateCategoryDto } from '../../dtos/admin-update-category.dto';
import { AdminReorderCategoriesDto } from '../../dtos/admin-reorder-categories.dto';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Phase 33 (2026-05-21) — try to extract a media publicId from
 * a URL. See category controller history for rationale.
 */
function extractmediaPublicId(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
  return match ? match[1]! : null;
}

/**
 * Phase 34 (2026-05-21) — Redis cache key for the storefront category
 * tree. Invalidated by every admin mutation that affects tree shape
 * (create/update/delete/deactivate/reorder).
 */
const STOREFRONT_TREE_CACHE_KEY = 'storefront:categories:tree';

@ApiTags('Admin - Categories')
@Controller({ path: 'admin/categories', version: '1' })
@UseGuards(AdminAuthGuard, PermissionsGuard)
// Phase 33 (2026-05-21) — granular @Permissions per method.
export class AdminCategoriesController {
  private readonly logger = new Logger(AdminCategoriesController.name);

  constructor(
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepo: ICategoryRepository,
    private readonly media: MediaStorageAdapter,
    private readonly redis: RedisService,
  ) {}

  /**
   * Phase 34 (2026-05-21) — drop the cached storefront tree whenever
   * the taxonomy mutates. Failures here log but never block — a
   * Redis outage just means the cache misses for 60s.
   */
  private async invalidateTreeCache(): Promise<void> {
    try {
      await this.redis.del(STOREFRONT_TREE_CACHE_KEY);
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate storefront tree cache: ${(err as Error).message}`,
      );
    }
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  @ApiOperation({ summary: 'List all categories (flat list)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'parentId', required: false })
  @ApiQuery({ name: 'level', required: false })
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('parentId') parentId?: string,
    @Query('level') level?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));

    const { categories, total } = await this.categoryRepo.findAllPaginated({
      page: pageNum, limit: limitNum, search, parentId,
      level: level !== undefined && level !== '' ? parseInt(level, 10) : undefined,
    });

    return {
      success: true,
      message: 'Categories retrieved',
      data: {
        categories,
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      },
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  @ApiOperation({ summary: 'Get a single category' })
  async getOne(@Param('id') id: string) {
    const category = await this.categoryRepo.findById(id);
    if (!category) throw new NotFoundAppException('Category not found');
    return { success: true, message: 'Category retrieved', data: { category } };
  }

  @Get(':id/audit-log')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  @ApiOperation({ summary: 'Audit log for a single category (Phase 34)' })
  async getAuditLog(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    const parsedOffset = offset ? Number.parseInt(offset, 10) : undefined;
    const entries = await this.categoryRepo.findAuditLogForCategory(id, {
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      offset: Number.isFinite(parsedOffset) ? parsedOffset : undefined,
    });
    return { success: true, message: 'Audit log retrieved', data: entries };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Create a category' })
  async create(
    @CurrentAdmin() adminId: string,
    @Body() dto: AdminCreateCategoryDto,
  ) {
    const slug = dto.slug || toSlug(dto.name);

    let level = 0;
    if (dto.parentId) {
      const parent = await this.categoryRepo.findById(dto.parentId);
      if (!parent) throw new NotFoundAppException('Parent category not found');
      level = parent.level + 1;
    }

    let category;
    try {
      category = await this.categoryRepo.create({
        name: dto.name,
        slug,
        description: dto.description ?? null,
        imageUrl: dto.imageUrl ?? null,
        bannerUrl: dto.bannerUrl ?? null,
        metaTitle: dto.metaTitle ?? null,
        metaDescription: dto.metaDescription ?? null,
        parentId: dto.parentId ?? null,
        level,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive !== false,
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new BadRequestAppException(`A category with slug "${slug}" already exists`);
      }
      throw err;
    }

    await this.categoryRepo.writeAuditLog({
      categoryId: category.id,
      action: 'CREATE',
      adminId,
      previousState: null,
      newState: category,
    });
    await this.invalidateTreeCache();

    return { success: true, message: 'Category created', data: { category } };
  }

  @Patch('reorder')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Bulk reorder sibling categories (Phase 34)' })
  async reorder(
    @CurrentAdmin() adminId: string,
    @Body() dto: AdminReorderCategoriesDto,
  ) {
    // Phase 34 (2026-05-21) — guard rails before the bulk update:
    //   1. Every id must resolve to a real category.
    //   2. Every id must share the same parentId. Reorder is a
    //      sibling-only operation; promoting/demoting across parents
    //      goes through the regular PATCH /:id endpoint (which runs
    //      the cycle + level-cascade machinery).
    const ids = dto.items.map((i) => i.id);
    const found = await Promise.all(ids.map((id) => this.categoryRepo.findById(id)));
    const missing: string[] = [];
    found.forEach((cat, idx) => {
      if (!cat) missing.push(ids[idx]!);
    });
    if (missing.length > 0) {
      throw new BadRequestAppException(`Categories not found: ${missing.join(', ')}`);
    }
    const firstParent = found[0]?.parentId ?? null;
    const mismatched = found.filter((c) => (c?.parentId ?? null) !== firstParent);
    if (mismatched.length > 0) {
      throw new BadRequestAppException(
        'All categories in a reorder batch must share the same parent. ' +
          'Use PATCH /admin/categories/:id to change parents.',
      );
    }

    await this.categoryRepo.bulkReorder(dto.items);

    // One REORDER audit row per affected category — simpler to query
    // by categoryId in the per-category history view than to fold
    // them into a single "bulk" entry.
    await Promise.all(
      dto.items.map((item, idx) =>
        this.categoryRepo.writeAuditLog({
          categoryId: item.id,
          action: 'REORDER',
          adminId,
          previousState: { sortOrder: found[idx]?.sortOrder ?? null },
          newState: { sortOrder: item.sortOrder },
        }),
      ),
    );
    await this.invalidateTreeCache();

    return {
      success: true,
      message: `${dto.items.length} categor${dto.items.length === 1 ? 'y' : 'ies'} reordered`,
    };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Update a category' })
  async update(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
    @Body() dto: AdminUpdateCategoryDto,
  ) {
    const existing = await this.categoryRepo.findById(id);
    if (!existing) throw new NotFoundAppException('Category not found');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.slug !== undefined && dto.slug !== existing.slug) {
      const slugExists = await this.categoryRepo.findBySlugExcluding(dto.slug, id);
      if (slugExists) throw new BadRequestAppException(`Slug "${dto.slug}" already taken`);
      data.slug = dto.slug;
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.bannerUrl !== undefined) data.bannerUrl = dto.bannerUrl || null;
    if (dto.metaTitle !== undefined) data.metaTitle = dto.metaTitle || null;
    if (dto.metaDescription !== undefined) data.metaDescription = dto.metaDescription || null;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    // Detect "is this a deactivation" — different audit action than a
    // regular update.
    const isDeactivation = dto.isActive === false && existing.isActive === true;

    const parentChanged = dto.parentId !== undefined && dto.parentId !== existing.parentId;
    let category;
    if (parentChanged) {
      if (dto.parentId === id) {
        throw new BadRequestAppException('Category cannot be its own parent');
      }

      let newLevel = 0;
      if (dto.parentId) {
        const parent = await this.categoryRepo.findById(dto.parentId);
        if (!parent) throw new NotFoundAppException('Parent category not found');

        const newParentAncestors = await this.categoryRepo.findAncestorIds(dto.parentId);
        if (newParentAncestors.includes(id)) {
          throw new BadRequestAppException(
            'Cannot move category — would create a cycle in the hierarchy',
          );
        }

        data.parentId = dto.parentId;
        newLevel = parent.level + 1;
      } else {
        data.parentId = null;
        newLevel = 0;
      }

      try {
        category = await this.categoryRepo.updateWithLevelCascade(id, data, newLevel);
      } catch (err: any) {
        if (err?.code === 'P2002') {
          throw new BadRequestAppException('Slug already in use');
        }
        throw err;
      }
    } else {
      try {
        category = await this.categoryRepo.update(id, data);
      } catch (err: any) {
        if (err?.code === 'P2002') {
          throw new BadRequestAppException('Slug already in use');
        }
        throw err;
      }
    }

    await this.categoryRepo.writeAuditLog({
      categoryId: id,
      action: isDeactivation ? 'DEACTIVATE' : 'UPDATE',
      adminId,
      previousState: existing,
      newState: category,
    });
    await this.invalidateTreeCache();

    return { success: true, message: 'Category updated', data: { category } };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Delete or deactivate a category' })
  async delete(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
  ) {
    const category = await this.categoryRepo.findWithCounts(id);
    if (!category) throw new NotFoundAppException('Category not found');

    if (category._count.products > 0 || category._count.children > 0) {
      await this.categoryRepo.deactivate(id);
      await this.categoryRepo.writeAuditLog({
        categoryId: id,
        action: 'DEACTIVATE',
        adminId,
        previousState: { isActive: true },
        newState: { isActive: false },
        reason: 'Has products or children',
      });
      await this.invalidateTreeCache();
      return { success: true, message: 'Category deactivated (has associated products or children)' };
    }

    let deleted: { imageUrl: string | null; bannerUrl: string | null } | null;
    try {
      deleted = await this.categoryRepo.deleteTransactional(id);
    } catch (err: any) {
      if (err?.message === 'CATEGORY_NOT_EMPTY') {
        await this.categoryRepo.deactivate(id);
        await this.categoryRepo.writeAuditLog({
          categoryId: id,
          action: 'DEACTIVATE',
          adminId,
          previousState: { isActive: true },
          newState: { isActive: false },
          reason: 'Children or products added during deletion (race)',
        });
        await this.invalidateTreeCache();
        return {
          success: true,
          message: 'Category deactivated (children or products added during deletion)',
        };
      }
      throw err;
    }

    // Note: the audit row writes BEFORE the cascade-delete clears the
    // CategoryAuditLog rows for this category (CASCADE delete on the
    // FK). It still ends up purged, but the rest of the system sees
    // a brief window with the trail in place — acceptable for
    // forensic dumps that snapshot the DB.
    if (deleted) {
      await this.categoryRepo.writeAuditLog({
        categoryId: id,
        action: 'DELETE',
        adminId,
        previousState: { ...category, ...deleted },
        newState: null,
      });
    }
    await this.invalidateTreeCache();

    if (deleted) {
      const ids = [
        extractmediaPublicId(deleted.imageUrl),
        extractmediaPublicId(deleted.bannerUrl),
      ].filter((v): v is string => v !== null);
      for (const publicId of ids) {
        this.media.delete(publicId).catch((err) => {
          this.logger.warn(
            `media cleanup failed for category asset ${publicId}: ${err?.message}`,
          );
        });
      }
    }

    return { success: true, message: 'Category deleted' };
  }
}
