import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';
import {
  NotFoundAppException,
  BadRequestAppException,
} from '../../../../../core/exceptions';
import { AdminAuthGuard } from '../../../../../core/guards';

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
  constructor(private readonly prisma: PrismaService) {}

  // ─── List all categories (flat, paginated, searchable) ────────────

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
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (parentId) {
      where.parentId = parentId;
    }

    if (level !== undefined && level !== '') {
      where.level = parseInt(level, 10);
    }

    const [categories, total] = await Promise.all([
      this.prisma.category.findMany({
        where,
        include: {
          parent: { select: { id: true, name: true, slug: true } },
          _count: {
            select: {
              children: true,
              products: true,
              metafieldDefinitions: true,
            },
          },
        },
        orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        skip,
        take: limitNum,
      }),
      this.prisma.category.count({ where }),
    ]);

    return {
      success: true,
      message: 'Categories retrieved',
      data: {
        categories,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  // ─── Get single category ──────────────────────────────────────────

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single category' })
  async getOne(@Param('id') id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        children: {
          select: { id: true, name: true, slug: true, level: true, sortOrder: true, isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
        _count: {
          select: { products: true, children: true, metafieldDefinitions: true },
        },
      },
    });

    if (!category) throw new NotFoundAppException('Category not found');

    return {
      success: true,
      message: 'Category retrieved',
      data: { category },
    };
  }

  // ─── Create category ──────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a category' })
  async create(@Body() body: any) {
    const { name, slug: customSlug, description, imageUrl, parentId, sortOrder, isActive } = body;

    if (!name || !name.trim()) {
      throw new BadRequestAppException('name is required');
    }

    const slug = customSlug || toSlug(name);

    // Check slug uniqueness
    const existing = await this.prisma.category.findUnique({ where: { slug } });
    if (existing) {
      throw new BadRequestAppException(`A category with slug "${slug}" already exists`);
    }

    // Determine level from parent
    let level = 0;
    if (parentId) {
      const parent = await this.prisma.category.findUnique({ where: { id: parentId } });
      if (!parent) throw new NotFoundAppException('Parent category not found');
      level = parent.level + 1;
    }

    const category = await this.prisma.category.create({
      data: {
        name: name.trim(),
        slug,
        description: description || null,
        imageUrl: imageUrl || null,
        parentId: parentId || null,
        level,
        sortOrder: sortOrder ?? 0,
        isActive: isActive !== false,
      },
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        _count: { select: { products: true, children: true, metafieldDefinitions: true } },
      },
    });

    return {
      success: true,
      message: 'Category created',
      data: { category },
    };
  }

  // ─── Update category ──────────────────────────────────────────────

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a category' })
  async update(@Param('id') id: string, @Body() body: any) {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundAppException('Category not found');

    const data: any = {};

    if (body.name !== undefined) data.name = body.name.trim();
    if (body.slug !== undefined) {
      if (body.slug !== existing.slug) {
        const slugExists = await this.prisma.category.findFirst({
          where: { slug: body.slug, id: { not: id } },
        });
        if (slugExists) throw new BadRequestAppException(`Slug "${body.slug}" already taken`);
      }
      data.slug = body.slug;
    }
    if (body.description !== undefined) data.description = body.description;
    if (body.imageUrl !== undefined) data.imageUrl = body.imageUrl;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    // Handle parent change (recalculate level)
    if (body.parentId !== undefined && body.parentId !== existing.parentId) {
      if (body.parentId === id) throw new BadRequestAppException('Category cannot be its own parent');
      if (body.parentId) {
        const parent = await this.prisma.category.findUnique({ where: { id: body.parentId } });
        if (!parent) throw new NotFoundAppException('Parent category not found');
        data.parentId = body.parentId;
        data.level = parent.level + 1;
      } else {
        data.parentId = null;
        data.level = 0;
      }
    }

    const category = await this.prisma.category.update({
      where: { id },
      data,
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        _count: { select: { products: true, children: true, metafieldDefinitions: true } },
      },
    });

    return {
      success: true,
      message: 'Category updated',
      data: { category },
    };
  }

  // ─── Delete / deactivate category ─────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete or deactivate a category' })
  async delete(@Param('id') id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true, children: true } } },
    });
    if (!category) throw new NotFoundAppException('Category not found');

    // If has products or children, soft-delete
    if (category._count.products > 0 || category._count.children > 0) {
      await this.prisma.category.update({
        where: { id },
        data: { isActive: false },
      });
      return { success: true, message: 'Category deactivated (has associated products or children)' };
    }

    // Otherwise hard delete
    await this.prisma.category.delete({ where: { id } });
    return { success: true, message: 'Category deleted' };
  }
}
