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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';
import { CloudinaryAdapter } from '../../../../../integrations/cloudinary/cloudinary.adapter';
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

@ApiTags('Admin - Brands')
@Controller({ path: 'admin/brands', version: '1' })
@UseGuards(AdminAuthGuard)
export class AdminBrandsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryAdapter,
  ) {}

  // ─── List all brands ──────────────────────────────────────────────

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all brands' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
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

    const [brands, total] = await Promise.all([
      this.prisma.brand.findMany({
        where,
        include: {
          _count: { select: { products: true } },
        },
        orderBy: [{ name: 'asc' }],
        skip,
        take: limitNum,
      }),
      this.prisma.brand.count({ where }),
    ]);

    return {
      success: true,
      message: 'Brands retrieved',
      data: {
        brands,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  // ─── Get single brand with products ───────────────────────────────

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single brand with its products' })
  async getOne(@Param('id') id: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { id },
      include: {
        _count: { select: { products: true } },
        products: {
          where: { isDeleted: false },
          select: {
            id: true,
            title: true,
            slug: true,
            status: true,
            basePrice: true,
            images: {
              take: 1,
              orderBy: { sortOrder: 'asc' },
              select: { url: true },
            },
          },
          orderBy: { title: 'asc' },
          take: 200,
        },
      },
    });

    if (!brand) throw new NotFoundAppException('Brand not found');

    return {
      success: true,
      message: 'Brand retrieved',
      data: { brand },
    };
  }

  // ─── Create brand ─────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a brand' })
  async create(@Body() body: any) {
    const { name, slug: customSlug, logoUrl, isActive } = body;

    if (!name || !name.trim()) {
      throw new BadRequestAppException('name is required');
    }

    const slug = customSlug || toSlug(name);

    const existingSlug = await this.prisma.brand.findUnique({ where: { slug } });
    if (existingSlug) {
      throw new BadRequestAppException(`A brand with slug "${slug}" already exists`);
    }

    const existingName = await this.prisma.brand.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' } },
    });
    if (existingName) {
      throw new BadRequestAppException(`A brand with name "${name}" already exists`);
    }

    const brand = await this.prisma.brand.create({
      data: {
        name: name.trim(),
        slug,
        logoUrl: logoUrl || null,
        isActive: isActive !== false,
      },
      include: { _count: { select: { products: true } } },
    });

    return {
      success: true,
      message: 'Brand created',
      data: { brand },
    };
  }

  // ─── Update brand ─────────────────────────────────────────────────

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a brand' })
  async update(@Param('id') id: string, @Body() body: any) {
    const existing = await this.prisma.brand.findUnique({ where: { id } });
    if (!existing) throw new NotFoundAppException('Brand not found');

    const data: any = {};

    if (body.name !== undefined) data.name = body.name.trim();
    if (body.slug !== undefined) {
      if (body.slug !== existing.slug) {
        const slugExists = await this.prisma.brand.findFirst({
          where: { slug: body.slug, id: { not: id } },
        });
        if (slugExists) throw new BadRequestAppException(`Slug "${body.slug}" already taken`);
      }
      data.slug = body.slug;
    }
    if (body.logoUrl !== undefined) data.logoUrl = body.logoUrl;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    const brand = await this.prisma.brand.update({
      where: { id },
      data,
      include: { _count: { select: { products: true } } },
    });

    return {
      success: true,
      message: 'Brand updated',
      data: { brand },
    };
  }

  // ─── Add products to brand ────────────────────────────────────────

  @Post(':id/products')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add products to a brand (set brandId)' })
  async addProducts(@Param('id') id: string, @Body() body: { productIds: string[] }) {
    const brand = await this.prisma.brand.findUnique({ where: { id } });
    if (!brand) throw new NotFoundAppException('Brand not found');

    if (!body.productIds || !Array.isArray(body.productIds) || body.productIds.length === 0) {
      throw new BadRequestAppException('productIds array is required');
    }

    const result = await this.prisma.product.updateMany({
      where: { id: { in: body.productIds }, isDeleted: false },
      data: { brandId: id },
    });

    return {
      success: true,
      message: `${result.count} product(s) added to brand`,
      data: { updated: result.count },
    };
  }

  // ─── Remove product from brand ────────────────────────────────────

  @Delete(':id/products/:productId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a product from brand (unset brandId)' })
  async removeProduct(@Param('id') id: string, @Param('productId') productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, brandId: id, isDeleted: false },
    });
    if (!product) throw new NotFoundAppException('Product not found in this brand');

    await this.prisma.product.update({
      where: { id: productId },
      data: { brandId: null },
    });

    return {
      success: true,
      message: 'Product removed from brand',
    };
  }

  // ─── Upload logo ───────────────────────────────────────────────────

  @Post(':id/logo')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('logo'))
  @ApiOperation({ summary: 'Upload brand logo' })
  async uploadLogo(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    const brand = await this.prisma.brand.findUnique({ where: { id } });
    if (!brand) throw new NotFoundAppException('Brand not found');
    if (!file) throw new BadRequestAppException('No file uploaded');

    const result = await this.cloudinary.upload(file.buffer, {
      folder: `brands/${id}`,
      resourceType: 'image',
    });

    const updated = await this.prisma.brand.update({
      where: { id },
      data: { logoUrl: result.secureUrl },
    });

    return {
      success: true,
      message: 'Logo uploaded',
      data: { logoUrl: updated.logoUrl },
    };
  }

  // ─── Remove logo ──────────────────────────────────────────────────

  @Delete(':id/logo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove brand logo' })
  async removeLogo(@Param('id') id: string) {
    const brand = await this.prisma.brand.findUnique({ where: { id } });
    if (!brand) throw new NotFoundAppException('Brand not found');

    await this.prisma.brand.update({
      where: { id },
      data: { logoUrl: null },
    });

    return { success: true, message: 'Logo removed' };
  }

  // ─── Delete / deactivate brand ────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete or deactivate a brand' })
  async delete(@Param('id') id: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!brand) throw new NotFoundAppException('Brand not found');

    if (brand._count.products > 0) {
      await this.prisma.brand.update({
        where: { id },
        data: { isActive: false },
      });
      return { success: true, message: 'Brand deactivated (has associated products)' };
    }

    await this.prisma.brand.delete({ where: { id } });
    return { success: true, message: 'Brand deleted' };
  }
}
