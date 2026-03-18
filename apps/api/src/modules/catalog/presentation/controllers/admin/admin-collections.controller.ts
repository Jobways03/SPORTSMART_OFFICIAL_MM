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
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';
import { AdminAuthGuard } from '../../../../admin/infrastructure/guards/admin-auth.guard';
import { CloudinaryAdapter } from '../../../../../integrations/cloudinary/cloudinary.adapter';
import { BadRequestAppException, NotFoundAppException } from '../../../../../core/exceptions';

@ApiTags('Admin Collections')
@Controller('admin/collections')
@UseGuards(AdminAuthGuard)
export class AdminCollectionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryAdapter,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async listCollections(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [collections, total] = await Promise.all([
      this.prisma.productCollection.findMany({
        where,
        include: { _count: { select: { products: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      this.prisma.productCollection.count({ where }),
    ]);

    const mapped = collections.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      imageUrl: c.imageUrl,
      isActive: c.isActive,
      productCount: c._count.products,
      createdAt: c.createdAt,
    }));

    return {
      success: true,
      message: 'Collections retrieved',
      data: {
        collections: mapped,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getCollection(@Param('id') id: string) {
    const collection = await this.prisma.productCollection.findUnique({
      where: { id },
      include: {
        products: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                slug: true,
                status: true,
                basePrice: true,
                images: {
                  where: { isPrimary: true },
                  select: { url: true },
                  take: 1,
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!collection) throw new NotFoundAppException('Collection not found');

    return {
      success: true,
      message: 'Collection retrieved',
      data: {
        ...collection,
        productCount: collection.products.length,
      },
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createCollection(
    @Body() body: { name: string; description?: string; slug?: string },
  ) {
    const { name, description } = body;
    if (!name?.trim()) throw new BadRequestAppException('Name is required');

    const slug = (body.slug?.trim() || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const existing = await this.prisma.productCollection.findUnique({ where: { slug } });
    if (existing) throw new BadRequestAppException('A collection with this name already exists');

    const collection = await this.prisma.productCollection.create({
      data: { name: name.trim(), slug, description: description?.trim() || null },
    });

    return { success: true, message: 'Collection created', data: collection };
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async updateCollection(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; isActive?: boolean; slug?: string },
  ) {
    const collection = await this.prisma.productCollection.findUnique({ where: { id } });
    if (!collection) throw new NotFoundAppException('Collection not found');

    const data: any = {};
    if (body.slug?.trim()) {
      data.slug = body.slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
    }
    if (body.name !== undefined) {
      data.name = body.name.trim();
      if (!data.slug) {
        data.slug = body.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      }
    }
    if (body.description !== undefined) data.description = body.description.trim() || null;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    const updated = await this.prisma.productCollection.update({
      where: { id },
      data,
    });

    return { success: true, message: 'Collection updated', data: updated };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteCollection(@Param('id') id: string) {
    const collection = await this.prisma.productCollection.findUnique({ where: { id } });
    if (!collection) throw new NotFoundAppException('Collection not found');

    await this.prisma.productCollection.delete({ where: { id } });
    return { success: true, message: 'Collection deleted' };
  }

  @Post(':id/products')
  @HttpCode(HttpStatus.OK)
  async addProducts(
    @Param('id') id: string,
    @Body() body: { productIds: string[] },
  ) {
    const collection = await this.prisma.productCollection.findUnique({ where: { id } });
    if (!collection) throw new NotFoundAppException('Collection not found');

    const { productIds } = body;
    if (!productIds?.length) throw new BadRequestAppException('productIds is required');

    // Skip already-added products
    const existing = await this.prisma.productCollectionMap.findMany({
      where: { collectionId: id, productId: { in: productIds } },
      select: { productId: true },
    });
    const existingIds = new Set(existing.map((e) => e.productId));
    const newIds = productIds.filter((pid) => !existingIds.has(pid));

    if (newIds.length > 0) {
      await this.prisma.productCollectionMap.createMany({
        data: newIds.map((productId) => ({ productId, collectionId: id })),
      });
    }

    return { success: true, message: `${newIds.length} product(s) added to collection` };
  }

  @Delete(':id/products/:productId')
  @HttpCode(HttpStatus.OK)
  async removeProduct(
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    await this.prisma.productCollectionMap.deleteMany({
      where: { collectionId: id, productId },
    });
    return { success: true, message: 'Product removed from collection' };
  }

  @Post(':id/image')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const collection = await this.prisma.productCollection.findUnique({ where: { id } });
    if (!collection) throw new NotFoundAppException('Collection not found');
    if (!file) throw new BadRequestAppException('Image file is required');

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestAppException('Only JPEG, PNG, and WEBP images are allowed');
    }

    const result = await this.cloudinary.upload(file.buffer, {
      folder: `collections/${id}`,
    });

    const updated = await this.prisma.productCollection.update({
      where: { id },
      data: { imageUrl: result.secureUrl },
    });

    return { success: true, message: 'Image uploaded', data: { imageUrl: updated.imageUrl } };
  }

  @Delete(':id/image')
  @HttpCode(HttpStatus.OK)
  async deleteImage(@Param('id') id: string) {
    const collection = await this.prisma.productCollection.findUnique({ where: { id } });
    if (!collection) throw new NotFoundAppException('Collection not found');

    const updated = await this.prisma.productCollection.update({
      where: { id },
      data: { imageUrl: null },
    });

    return { success: true, message: 'Image removed', data: updated };
  }
}
