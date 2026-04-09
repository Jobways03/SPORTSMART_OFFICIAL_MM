import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { IBrandRepository, BrandListParams } from '../../domain/repositories/brand.repository.interface';

@Injectable()
export class PrismaBrandRepository implements IBrandRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllPaginated(params: BrandListParams): Promise<{ brands: any[]; total: number }> {
    const { page, limit, search } = params;
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
        include: { _count: { select: { products: true } } },
        orderBy: [{ name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.brand.count({ where }),
    ]);
    return { brands, total };
  }

  async findById(id: string): Promise<any | null> {
    return this.prisma.brand.findUnique({ where: { id } });
  }

  async findByIdWithProducts(id: string): Promise<any | null> {
    return this.prisma.brand.findUnique({
      where: { id },
      include: {
        _count: { select: { products: true } },
        products: {
          where: { isDeleted: false },
          select: {
            id: true, title: true, slug: true, status: true, basePrice: true,
            images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } },
          },
          orderBy: { title: 'asc' },
          take: 200,
        },
      },
    });
  }

  async findBySlug(slug: string): Promise<any | null> {
    return this.prisma.brand.findUnique({ where: { slug } });
  }

  async findBySlugExcluding(slug: string, excludeId: string): Promise<any | null> {
    return this.prisma.brand.findFirst({ where: { slug, id: { not: excludeId } } });
  }

  async findByNameInsensitive(name: string): Promise<any | null> {
    return this.prisma.brand.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' } },
    });
  }

  async create(data: any): Promise<any> {
    return this.prisma.brand.create({
      data,
      include: { _count: { select: { products: true } } },
    });
  }

  async update(id: string, data: any): Promise<any> {
    return this.prisma.brand.update({
      where: { id },
      data,
      include: { _count: { select: { products: true } } },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.brand.delete({ where: { id } });
  }

  async deactivate(id: string): Promise<void> {
    await this.prisma.brand.update({ where: { id }, data: { isActive: false } });
  }

  async findWithCounts(id: string): Promise<any | null> {
    return this.prisma.brand.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
  }

  async addProductsToBrand(brandId: string, productIds: string[]): Promise<number> {
    const result = await this.prisma.product.updateMany({
      where: { id: { in: productIds }, isDeleted: false },
      data: { brandId },
    });
    return result.count;
  }

  async removeProductFromBrand(brandId: string, productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, brandId, isDeleted: false },
    });
    if (!product) throw new Error('Product not found in this brand');
    await this.prisma.product.update({ where: { id: productId }, data: { brandId: null } });
  }

  async updateLogoUrl(id: string, logoUrl: string | null): Promise<any> {
    return this.prisma.brand.update({ where: { id }, data: { logoUrl } });
  }

  async findAllActive(search?: string): Promise<any[]> {
    return this.prisma.brand.findMany({
      where: {
        isActive: true,
        ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }
}
