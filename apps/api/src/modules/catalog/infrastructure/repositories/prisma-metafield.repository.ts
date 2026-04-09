import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { IMetafieldRepository } from '../../domain/repositories/metafield.repository.interface';
import { Prisma } from '@prisma/client';

@Injectable()
export class PrismaMetafieldRepository implements IMetafieldRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findDefinitions(where: any): Promise<any[]> {
    return this.prisma.metafieldDefinition.findMany({
      where,
      include: { category: { select: { id: true, name: true, slug: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findDefinitionById(id: string): Promise<any | null> {
    return this.prisma.metafieldDefinition.findUnique({ where: { id } });
  }

  async findDefinitionByNamespaceKey(namespace: string, key: string, categoryId?: string | null): Promise<any | null> {
    return this.prisma.metafieldDefinition.findFirst({
      where: { namespace, key, categoryId: categoryId || null },
    });
  }

  async createDefinition(data: any): Promise<any> {
    return this.prisma.metafieldDefinition.create({
      data,
      include: { category: { select: { id: true, name: true, slug: true } } },
    });
  }

  async updateDefinition(id: string, data: any): Promise<any> {
    return this.prisma.metafieldDefinition.update({
      where: { id },
      data,
      include: { category: { select: { id: true, name: true, slug: true } } },
    });
  }

  async deleteDefinition(id: string): Promise<void> {
    await this.prisma.metafieldDefinition.delete({ where: { id } });
  }

  async deactivateDefinition(id: string): Promise<void> {
    await this.prisma.metafieldDefinition.update({ where: { id }, data: { isActive: false } });
  }

  async countMetafieldValues(definitionId: string): Promise<number> {
    return this.prisma.productMetafield.count({ where: { metafieldDefinitionId: definitionId } });
  }

  async findDefinitionWithCounts(id: string): Promise<any | null> {
    return this.prisma.metafieldDefinition.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        _count: { select: { metafieldValues: true, filterConfigs: true } },
      },
    });
  }

  async bulkCreateDefinitions(categoryId: string, definitions: any[]): Promise<{ created: any[]; skipped: any[] }> {
    const created: any[] = [];
    const skipped: any[] = [];

    for (const def of definitions) {
      if (!def.namespace || !def.key || !def.name || !def.type) {
        skipped.push({ ...def, reason: 'Missing required fields' });
        continue;
      }
      const existing = await this.prisma.metafieldDefinition.findFirst({
        where: { namespace: def.namespace, key: def.key, categoryId },
      });
      if (existing) {
        skipped.push({ ...def, reason: 'Already exists' });
        continue;
      }
      const result = await this.prisma.metafieldDefinition.create({
        data: {
          namespace: def.namespace, key: def.key, name: def.name, type: def.type as any,
          choices: def.choices ?? Prisma.JsonNull,
          ownerType: 'CATEGORY', categoryId,
          isRequired: def.isRequired ?? false, sortOrder: def.sortOrder ?? 0,
        },
      });
      created.push(result);
    }
    return { created, skipped };
  }

  async findProductMetafields(productId: string): Promise<any[]> {
    return this.prisma.productMetafield.findMany({
      where: { productId },
      include: {
        metafieldDefinition: {
          select: {
            id: true, namespace: true, key: true, name: true, description: true,
            type: true, choices: true, validations: true, ownerType: true,
            categoryId: true, pinned: true, sortOrder: true, isRequired: true,
          },
        },
      },
      orderBy: { metafieldDefinition: { sortOrder: 'asc' } },
    });
  }

  async findAvailableDefinitions(categoryId: string | null): Promise<any[]> {
    if (categoryId) {
      const categoryIds = await this.getCategoryHierarchyIds(categoryId);
      return this.prisma.metafieldDefinition.findMany({
        where: {
          isActive: true,
          OR: [
            { categoryId: { in: categoryIds }, ownerType: 'CATEGORY' },
            { ownerType: 'CUSTOM' },
          ],
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
    }
    return this.prisma.metafieldDefinition.findMany({
      where: { isActive: true, ownerType: 'CUSTOM' },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async upsertProductMetafield(productId: string, definitionId: string, valueData: any): Promise<any> {
    return this.prisma.productMetafield.upsert({
      where: { productId_metafieldDefinitionId: { productId, metafieldDefinitionId: definitionId } },
      create: { productId, metafieldDefinitionId: definitionId, ...valueData },
      update: { ...valueData },
    });
  }

  async deleteProductMetafield(metafieldId: string): Promise<void> {
    await this.prisma.productMetafield.delete({ where: { id: metafieldId } });
  }

  async deleteProductMetafieldByDefinition(productId: string, definitionId: string): Promise<void> {
    await this.prisma.productMetafield.deleteMany({
      where: { productId, metafieldDefinitionId: definitionId },
    });
  }

  async findProductMetafield(metafieldId: string, productId: string): Promise<any | null> {
    return this.prisma.productMetafield.findFirst({ where: { id: metafieldId, productId } });
  }

  async getCategoryHierarchyIds(categoryId: string): Promise<string[]> {
    const ids: string[] = [];
    let current: any = await this.prisma.category.findUnique({ where: { id: categoryId } });
    while (current) {
      ids.push(current.id);
      current = current.parentId
        ? await this.prisma.category.findUnique({ where: { id: current.parentId } })
        : null;
    }
    return ids;
  }
}
