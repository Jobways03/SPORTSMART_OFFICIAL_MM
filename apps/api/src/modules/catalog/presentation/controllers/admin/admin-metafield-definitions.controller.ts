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
import {
  NotFoundAppException,
  BadRequestAppException,
} from '../../../../../core/exceptions';
import { AdminAuthGuard } from '../../../../../core/guards';
import { Prisma } from '@prisma/client';
import { METAFIELD_REPOSITORY, IMetafieldRepository } from '../../../domain/repositories/metafield.repository.interface';
import { CATEGORY_REPOSITORY, ICategoryRepository } from '../../../domain/repositories/category.repository.interface';

const VALID_TYPES = [
  'SINGLE_LINE_TEXT', 'MULTI_LINE_TEXT', 'NUMBER_INTEGER', 'NUMBER_DECIMAL',
  'BOOLEAN', 'DATE', 'COLOR', 'URL', 'DIMENSION', 'WEIGHT', 'VOLUME',
  'RATING', 'JSON', 'SINGLE_SELECT', 'MULTI_SELECT', 'FILE_REFERENCE',
] as const;

@ApiTags('Admin - Metafield Definitions')
@Controller({ path: 'admin', version: '1' })
@UseGuards(AdminAuthGuard)
export class AdminMetafieldDefinitionsController {
  constructor(
    @Inject(METAFIELD_REPOSITORY) private readonly metafieldRepo: IMetafieldRepository,
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepo: ICategoryRepository,
  ) {}

  // ─── List definitions ──────────────────────────────────────────────

  @Get('metafield-definitions')
  @HttpCode(HttpStatus.OK)
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

  // ─── Get single definition ────────────────────────────────────────

  @Get('metafield-definitions/:id')
  @HttpCode(HttpStatus.OK)
  async getById(@Param('id') id: string) {
    const definition = await this.metafieldRepo.findDefinitionWithCounts(id);

    if (!definition) throw new NotFoundAppException('Metafield definition not found');

    return { success: true, message: 'Metafield definition retrieved', data: { definition } };
  }

  // ─── Get definitions for a category (with inheritance) ────────────

  @Get('categories/:categoryId/metafield-definitions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get metafield definitions for a category including inherited from parents' })
  async getForCategory(@Param('categoryId') categoryId: string) {
    const category = await this.categoryRepo.findById(categoryId);
    if (!category) throw new NotFoundAppException('Category not found');

    // Walk up the category hierarchy to collect inherited definitions
    const categoryIds = await this.metafieldRepo.getCategoryHierarchyIds(categoryId);

    // Fetch definitions from this category and all ancestors
    const definitions = await this.metafieldRepo.findDefinitions({
      isActive: true,
      OR: [
        { categoryId: { in: categoryIds }, ownerType: 'CATEGORY' },
        { ownerType: 'CUSTOM' }, // custom (merchant-level) always included
      ],
    });

    // Mark each as own vs inherited
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

  // ─── Create definition ────────────────────────────────────────────

  @Post('metafield-definitions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a metafield definition' })
  async create(@Body() body: any) {
    const { namespace, key, name, description, type, validations, choices, ownerType, categoryId, pinned, sortOrder, isRequired } = body;

    if (!namespace || !key || !name || !type) {
      throw new BadRequestAppException('namespace, key, name, and type are required');
    }

    if (!VALID_TYPES.includes(type)) {
      throw new BadRequestAppException(`Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`);
    }

    // Validate key format (lowercase, alphanumeric + underscore)
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      throw new BadRequestAppException('Key must start with a lowercase letter and contain only lowercase letters, numbers, and underscores');
    }

    if (ownerType === 'CATEGORY' && !categoryId) {
      throw new BadRequestAppException('categoryId is required for CATEGORY type definitions');
    }

    if (categoryId) {
      const category = await this.categoryRepo.findById(categoryId);
      if (!category) throw new NotFoundAppException('Category not found');
    }

    // Validate choices for select types
    if ((type === 'SINGLE_SELECT' || type === 'MULTI_SELECT') && (!choices || !Array.isArray(choices) || choices.length === 0)) {
      throw new BadRequestAppException('choices are required for SINGLE_SELECT and MULTI_SELECT types');
    }

    // Check uniqueness — if an inactive one exists, reactivate it
    const existing = await this.metafieldRepo.findDefinitionByNamespaceKey(namespace, key, categoryId || null);
    if (existing) {
      if (!existing.isActive) {
        // Reactivate the soft-deleted definition with the new data
        const reactivated = await this.metafieldRepo.updateDefinition(existing.id, {
          name,
          description: description || null,
          type,
          validations: validations ?? Prisma.JsonNull,
          choices: choices ?? Prisma.JsonNull,
          ownerType: ownerType || 'CATEGORY',
          pinned: pinned ?? false,
          sortOrder: sortOrder ?? 0,
          isRequired: isRequired ?? false,
          isActive: true,
        });
        return { success: true, message: 'Metafield definition reactivated', data: { definition: reactivated } };
      }
      throw new BadRequestAppException(`A definition with namespace "${namespace}" and key "${key}" already exists for this category`);
    }

    const definition = await this.metafieldRepo.createDefinition({
      namespace,
      key,
      name,
      description: description || null,
      type,
      validations: validations ?? Prisma.JsonNull,
      choices: choices ?? Prisma.JsonNull,
      ownerType: ownerType || 'CATEGORY',
      categoryId: categoryId || null,
      pinned: pinned ?? false,
      sortOrder: sortOrder ?? 0,
      isRequired: isRequired ?? false,
    });

    return { success: true, message: 'Metafield definition created', data: { definition } };
  }

  // ─── Update definition ────────────────────────────────────────────

  @Patch('metafield-definitions/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a metafield definition' })
  async update(@Param('id') id: string, @Body() body: any) {
    const existing = await this.metafieldRepo.findDefinitionById(id);
    if (!existing) throw new NotFoundAppException('Metafield definition not found');

    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.choices !== undefined) updateData.choices = body.choices;
    if (body.validations !== undefined) updateData.validations = body.validations;
    if (body.pinned !== undefined) updateData.pinned = body.pinned;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
    if (body.isRequired !== undefined) updateData.isRequired = body.isRequired;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    // Type change is only allowed if no product metafield values exist
    if (body.type !== undefined && body.type !== existing.type) {
      const valueCount = await this.metafieldRepo.countMetafieldValues(id);
      if (valueCount > 0) {
        throw new BadRequestAppException(`Cannot change type: ${valueCount} products have values for this definition. Remove values first.`);
      }
      if (!VALID_TYPES.includes(body.type)) {
        throw new BadRequestAppException(`Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`);
      }
      updateData.type = body.type;
    }

    const definition = await this.metafieldRepo.updateDefinition(id, updateData);

    return { success: true, message: 'Metafield definition updated', data: { definition } };
  }

  // ─── Delete (deactivate) definition ───────────────────────────────

  @Delete('metafield-definitions/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete or deactivate a metafield definition' })
  async deactivate(@Param('id') id: string) {
    const existing = await this.metafieldRepo.findDefinitionWithCounts(id);
    if (!existing) throw new NotFoundAppException('Metafield definition not found');

    // Hard-delete if no product values or filter configs reference it
    if (existing._count.metafieldValues === 0 && existing._count.filterConfigs === 0) {
      await this.metafieldRepo.deleteDefinition(id);
      return { success: true, message: 'Metafield definition deleted' };
    }

    // Soft-delete if in use
    await this.metafieldRepo.deactivateDefinition(id);

    return { success: true, message: 'Metafield definition deactivated (has product values)' };
  }

  // ─── Bulk assign to category ──────────────────────────────────────

  @Post('categories/:categoryId/metafield-definitions/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk create metafield definitions for a category' })
  async bulkAssign(
    @Param('categoryId') categoryId: string,
    @Body() body: { definitions: Array<{ namespace: string; key: string; name: string; type: string; choices?: any[]; isRequired?: boolean; sortOrder?: number }> },
  ) {
    const category = await this.categoryRepo.findById(categoryId);
    if (!category) throw new NotFoundAppException('Category not found');

    if (!body.definitions || !Array.isArray(body.definitions) || body.definitions.length === 0) {
      throw new BadRequestAppException('definitions array is required');
    }

    const { created, skipped } = await this.metafieldRepo.bulkCreateDefinitions(categoryId, body.definitions);

    return {
      success: true,
      message: `Created ${created.length} definitions, skipped ${skipped.length}`,
      data: { created, skipped },
    };
  }
}
