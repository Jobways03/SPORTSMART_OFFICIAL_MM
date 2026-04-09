import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  Inject,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../../core/guards';
import { CloudinaryAdapter } from '../../../../../integrations/cloudinary/cloudinary.adapter';
import { BadRequestAppException, NotFoundAppException } from '../../../../../core/exceptions';
import { COLLECTION_REPOSITORY, ICollectionRepository } from '../../../domain/repositories/collection.repository.interface';

@ApiTags('Admin Collections')
@Controller('admin/collections')
@UseGuards(AdminAuthGuard)
export class AdminCollectionsController {
  constructor(
    @Inject(COLLECTION_REPOSITORY) private readonly collectionRepo: ICollectionRepository,
    private readonly cloudinary: CloudinaryAdapter,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async listCollections(@Query('page') page?: string, @Query('limit') limit?: string, @Query('search') search?: string) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const { collections, total } = await this.collectionRepo.findAllPaginated({ page: pageNum, limit: limitNum, search });
    const mapped = collections.map((c: any) => ({
      id: c.id, name: c.name, slug: c.slug, description: c.description,
      imageUrl: c.imageUrl, isActive: c.isActive,
      productCount: c._count.products, createdAt: c.createdAt,
    }));
    return {
      success: true, message: 'Collections retrieved',
      data: { collections: mapped, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } },
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getCollection(@Param('id') id: string) {
    const collection = await this.collectionRepo.findById(id);
    if (!collection) throw new NotFoundAppException('Collection not found');
    return { success: true, message: 'Collection retrieved', data: { ...collection, productCount: collection.products.length } };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createCollection(@Body() body: { name: string; description?: string; slug?: string }) {
    const { name, description } = body;
    if (!name?.trim()) throw new BadRequestAppException('Name is required');
    const slug = (body.slug?.trim() || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const existing = await this.collectionRepo.findBySlug(slug);
    if (existing) throw new BadRequestAppException('A collection with this name already exists');
    const collection = await this.collectionRepo.create({ name: name.trim(), slug, description: description?.trim() || null });
    return { success: true, message: 'Collection created', data: collection };
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async updateCollection(@Param('id') id: string, @Body() body: { name?: string; description?: string; isActive?: boolean; slug?: string }) {
    const collection = await this.collectionRepo.findBySlug('');
    const existing = await this.collectionRepo.findById(id);
    if (!existing) throw new NotFoundAppException('Collection not found');
    const data: any = {};
    if (body.slug?.trim()) data.slug = body.slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
    if (body.name !== undefined) {
      data.name = body.name.trim();
      if (!data.slug) data.slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
    if (body.description !== undefined) data.description = body.description.trim() || null;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    const updated = await this.collectionRepo.update(id, data);
    return { success: true, message: 'Collection updated', data: updated };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteCollection(@Param('id') id: string) {
    const collection = await this.collectionRepo.findById(id);
    if (!collection) throw new NotFoundAppException('Collection not found');
    await this.collectionRepo.delete(id);
    return { success: true, message: 'Collection deleted' };
  }

  @Post(':id/products')
  @HttpCode(HttpStatus.OK)
  async addProducts(@Param('id') id: string, @Body() body: { productIds: string[] }) {
    const collection = await this.collectionRepo.findById(id);
    if (!collection) throw new NotFoundAppException('Collection not found');
    const { productIds } = body;
    if (!productIds?.length) throw new BadRequestAppException('productIds is required');
    const count = await this.collectionRepo.addProducts(id, productIds);
    return { success: true, message: `${count} product(s) added to collection` };
  }

  @Delete(':id/products/:productId')
  @HttpCode(HttpStatus.OK)
  async removeProduct(@Param('id') id: string, @Param('productId') productId: string) {
    await this.collectionRepo.removeProduct(id, productId);
    return { success: true, message: 'Product removed from collection' };
  }

  @Post(':id/image')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadImage(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    const collection = await this.collectionRepo.findById(id);
    if (!collection) throw new NotFoundAppException('Collection not found');
    if (!file) throw new BadRequestAppException('Image file is required');
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) throw new BadRequestAppException('Only JPEG, PNG, and WEBP images are allowed');
    const result = await this.cloudinary.upload(file.buffer, { folder: `collections/${id}` });
    const updated = await this.collectionRepo.updateImageUrl(id, result.secureUrl);
    return { success: true, message: 'Image uploaded', data: { imageUrl: updated.imageUrl } };
  }

  @Delete(':id/image')
  @HttpCode(HttpStatus.OK)
  async deleteImage(@Param('id') id: string) {
    const collection = await this.collectionRepo.findById(id);
    if (!collection) throw new NotFoundAppException('Collection not found');
    const updated = await this.collectionRepo.updateImageUrl(id, null);
    return { success: true, message: 'Image removed', data: updated };
  }
}
