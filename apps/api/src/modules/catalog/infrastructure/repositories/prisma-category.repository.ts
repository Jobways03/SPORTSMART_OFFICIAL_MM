import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { ICategoryRepository, CategoryListParams } from '../../domain/repositories/category.repository.interface';

@Injectable()
export class PrismaCategoryRepository implements ICategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllPaginated(params: CategoryListParams): Promise<{ categories: any[]; total: number }> {
    const { page, limit, search, parentId, level } = params;
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (parentId) where.parentId = parentId;
    if (level !== undefined) where.level = level;

    const [categories, total] = await Promise.all([
      this.prisma.category.findMany({
        where,
        include: {
          parent: { select: { id: true, name: true, slug: true } },
          _count: { select: { children: true, products: true, metafieldDefinitions: true } },
        },
        orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.category.count({ where }),
    ]);
    return { categories, total };
  }

  async findById(id: string): Promise<any | null> {
    return this.prisma.category.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        children: {
          select: { id: true, name: true, slug: true, level: true, sortOrder: true, isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
        _count: { select: { products: true, children: true, metafieldDefinitions: true } },
      },
    });
  }

  async findBySlug(slug: string): Promise<any | null> {
    return this.prisma.category.findUnique({ where: { slug } });
  }

  async findBySlugExcluding(slug: string, excludeId: string): Promise<any | null> {
    return this.prisma.category.findFirst({ where: { slug, id: { not: excludeId } } });
  }

  async create(data: any): Promise<any> {
    return this.prisma.category.create({
      data,
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        _count: { select: { products: true, children: true, metafieldDefinitions: true } },
      },
    });
  }

  async update(id: string, data: any): Promise<any> {
    return this.prisma.category.update({
      where: { id },
      data,
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        _count: { select: { products: true, children: true, metafieldDefinitions: true } },
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.category.delete({ where: { id } });
  }

  async deactivate(id: string): Promise<void> {
    await this.prisma.category.update({ where: { id }, data: { isActive: false } });
  }

  async findWithCounts(id: string): Promise<any | null> {
    return this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true, children: true } } },
    });
  }

  async findActiveTree(): Promise<any[]> {
    return this.prisma.category.findMany({
      where: { parentId: null, isActive: true },
      include: {
        children: {
          where: { isActive: true },
          include: { children: { where: { isActive: true } } },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findCategoryOptions(categoryId: string): Promise<any[]> {
    return this.prisma.categoryOptionTemplate.findMany({
      where: { categoryId },
      include: {
        optionDefinition: { include: { values: { orderBy: { sortOrder: 'asc' } } } },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findAncestorIds(categoryId: string): Promise<string[]> {
    const ids: string[] = [];
    let current = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, parentId: true },
    });
    while (current) {
      ids.push(current.id);
      current = current.parentId
        ? await this.prisma.category.findUnique({
            where: { id: current.parentId },
            select: { id: true, parentId: true },
          })
        : null;
    }
    return ids;
  }
}
