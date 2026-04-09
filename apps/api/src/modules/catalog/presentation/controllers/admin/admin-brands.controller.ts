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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { CloudinaryAdapter } from '../../../../../integrations/cloudinary/cloudinary.adapter';
import {
  NotFoundAppException,
  BadRequestAppException,
} from '../../../../../core/exceptions';
import { AdminAuthGuard } from '../../../../../core/guards';
import { BRAND_REPOSITORY, IBrandRepository } from '../../../domain/repositories/brand.repository.interface';

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
    @Inject(BRAND_REPOSITORY) private readonly brandRepo: IBrandRepository,
    private readonly cloudinary: CloudinaryAdapter,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all brands' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  async list(@Query('page') page?: string, @Query('limit') limit?: string, @Query('search') search?: string) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const { brands, total } = await this.brandRepo.findAllPaginated({ page: pageNum, limit: limitNum, search });
    return {
      success: true, message: 'Brands retrieved',
      data: { brands, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } },
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single brand with its products' })
  async getOne(@Param('id') id: string) {
    const brand = await this.brandRepo.findByIdWithProducts(id);
    if (!brand) throw new NotFoundAppException('Brand not found');
    return { success: true, message: 'Brand retrieved', data: { brand } };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a brand' })
  async create(@Body() body: any) {
    const { name, slug: customSlug, logoUrl, isActive } = body;
    if (!name || !name.trim()) throw new BadRequestAppException('name is required');
    const slug = customSlug || toSlug(name);
    const existingSlug = await this.brandRepo.findBySlug(slug);
    if (existingSlug) throw new BadRequestAppException(`A brand with slug "${slug}" already exists`);
    const existingName = await this.brandRepo.findByNameInsensitive(name.trim());
    if (existingName) throw new BadRequestAppException(`A brand with name "${name}" already exists`);
    const brand = await this.brandRepo.create({ name: name.trim(), slug, logoUrl: logoUrl || null, isActive: isActive !== false });
    return { success: true, message: 'Brand created', data: { brand } };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a brand' })
  async update(@Param('id') id: string, @Body() body: any) {
    const existing = await this.brandRepo.findById(id);
    if (!existing) throw new NotFoundAppException('Brand not found');
    const data: any = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.slug !== undefined) {
      if (body.slug !== existing.slug) {
        const slugExists = await this.brandRepo.findBySlugExcluding(body.slug, id);
        if (slugExists) throw new BadRequestAppException(`Slug "${body.slug}" already taken`);
      }
      data.slug = body.slug;
    }
    if (body.logoUrl !== undefined) data.logoUrl = body.logoUrl;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    const brand = await this.brandRepo.update(id, data);
    return { success: true, message: 'Brand updated', data: { brand } };
  }

  @Post(':id/products')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add products to a brand (set brandId)' })
  async addProducts(@Param('id') id: string, @Body() body: { productIds: string[] }) {
    const brand = await this.brandRepo.findById(id);
    if (!brand) throw new NotFoundAppException('Brand not found');
    if (!body.productIds || !Array.isArray(body.productIds) || body.productIds.length === 0) {
      throw new BadRequestAppException('productIds array is required');
    }
    const count = await this.brandRepo.addProductsToBrand(id, body.productIds);
    return { success: true, message: `${count} product(s) added to brand`, data: { updated: count } };
  }

  @Delete(':id/products/:productId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a product from brand (unset brandId)' })
  async removeProduct(@Param('id') id: string, @Param('productId') productId: string) {
    try {
      await this.brandRepo.removeProductFromBrand(id, productId);
    } catch {
      throw new NotFoundAppException('Product not found in this brand');
    }
    return { success: true, message: 'Product removed from brand' };
  }

  @Post(':id/logo')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('logo'))
  @ApiOperation({ summary: 'Upload brand logo' })
  async uploadLogo(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    const brand = await this.brandRepo.findById(id);
    if (!brand) throw new NotFoundAppException('Brand not found');
    if (!file) throw new BadRequestAppException('No file uploaded');
    const result = await this.cloudinary.upload(file.buffer, { folder: `brands/${id}`, resourceType: 'image' });
    const updated = await this.brandRepo.updateLogoUrl(id, result.secureUrl);
    return { success: true, message: 'Logo uploaded', data: { logoUrl: updated.logoUrl } };
  }

  @Delete(':id/logo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove brand logo' })
  async removeLogo(@Param('id') id: string) {
    const brand = await this.brandRepo.findById(id);
    if (!brand) throw new NotFoundAppException('Brand not found');
    await this.brandRepo.updateLogoUrl(id, null);
    return { success: true, message: 'Logo removed' };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete or deactivate a brand' })
  async delete(@Param('id') id: string) {
    const brand = await this.brandRepo.findWithCounts(id);
    if (!brand) throw new NotFoundAppException('Brand not found');
    if (brand._count.products > 0) {
      await this.brandRepo.deactivate(id);
      return { success: true, message: 'Brand deactivated (has associated products)' };
    }
    await this.brandRepo.delete(id);
    return { success: true, message: 'Brand deleted' };
  }
}
