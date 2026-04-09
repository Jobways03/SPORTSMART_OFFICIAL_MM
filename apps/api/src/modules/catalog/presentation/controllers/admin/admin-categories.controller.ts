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
import { CATEGORY_REPOSITORY, ICategoryRepository } from '../../../domain/repositories/category.repository.interface';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@ApiTags('Admin - Categories')
@Controller({ path: 'admin/categories', version: '1' })
@UseGuards(AdminAuthGuard)
export class AdminCategoriesController {
  constructor(
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepo: ICategoryRepository,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
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
  @ApiOperation({ summary: 'Get a single category' })
  async getOne(@Param('id') id: string) {
    const category = await this.categoryRepo.findById(id);
    if (!category) throw new NotFoundAppException('Category not found');
    return { success: true, message: 'Category retrieved', data: { category } };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a category' })
  async create(@Body() body: any) {
    const { name, slug: customSlug, description, imageUrl, parentId, sortOrder, isActive } = body;
    if (!name || !name.trim()) throw new BadRequestAppException('name is required');

    const slug = customSlug || toSlug(name);
    const existing = await this.categoryRepo.findBySlug(slug);
    if (existing) throw new BadRequestAppException(`A category with slug "${slug}" already exists`);

    let level = 0;
    if (parentId) {
      const parent = await this.categoryRepo.findById(parentId);
      if (!parent) throw new NotFoundAppException('Parent category not found');
      level = parent.level + 1;
    }

    const category = await this.categoryRepo.create({
      name: name.trim(), slug, description: description || null,
      imageUrl: imageUrl || null, parentId: parentId || null,
      level, sortOrder: sortOrder ?? 0, isActive: isActive !== false,
    });

    return { success: true, message: 'Category created', data: { category } };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a category' })
  async update(@Param('id') id: string, @Body() body: any) {
    const existing = await this.categoryRepo.findById(id);
    if (!existing) throw new NotFoundAppException('Category not found');

    const data: any = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.slug !== undefined) {
      if (body.slug !== existing.slug) {
        const slugExists = await this.categoryRepo.findBySlugExcluding(body.slug, id);
        if (slugExists) throw new BadRequestAppException(`Slug "${body.slug}" already taken`);
      }
      data.slug = body.slug;
    }
    if (body.description !== undefined) data.description = body.description;
    if (body.imageUrl !== undefined) data.imageUrl = body.imageUrl;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    if (body.parentId !== undefined && body.parentId !== existing.parentId) {
      if (body.parentId === id) throw new BadRequestAppException('Category cannot be its own parent');
      if (body.parentId) {
        const parent = await this.categoryRepo.findById(body.parentId);
        if (!parent) throw new NotFoundAppException('Parent category not found');
        data.parentId = body.parentId;
        data.level = parent.level + 1;
      } else {
        data.parentId = null;
        data.level = 0;
      }
    }

    const category = await this.categoryRepo.update(id, data);
    return { success: true, message: 'Category updated', data: { category } };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete or deactivate a category' })
  async delete(@Param('id') id: string) {
    const category = await this.categoryRepo.findWithCounts(id);
    if (!category) throw new NotFoundAppException('Category not found');

    if (category._count.products > 0 || category._count.children > 0) {
      await this.categoryRepo.deactivate(id);
      return { success: true, message: 'Category deactivated (has associated products or children)' };
    }

    await this.categoryRepo.delete(id);
    return { success: true, message: 'Category deleted' };
  }
}
