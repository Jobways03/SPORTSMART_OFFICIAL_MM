import { Injectable, Logger } from '@nestjs/common';
import { MetafieldDefinitionAuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { IMetafieldRepository } from '../../domain/repositories/metafield.repository.interface';

@Injectable()
export class PrismaMetafieldRepository implements IMetafieldRepository {
  private readonly logger = new Logger(PrismaMetafieldRepository.name);

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

  /**
   * Phase 39 (2026-05-21) — single transaction so a partial failure
   * rolls back cleanly. Pre-Phase-39 a sequential loop committed
   * each row individually; a network blip halfway through left an
   * inconsistent set the admin couldn't easily reconcile.
   *
   * Validation (type + choices + key format) is enforced by the
   * controller-level DTO (BulkCreateMetafieldDefinitionsDto); this
   * method trusts its input shape and just handles "already exists"
   * dedup + the transactional commit.
   */
  async bulkCreateDefinitions(categoryId: string, definitions: any[]): Promise<{ created: any[]; skipped: any[] }> {
    if (definitions.length === 0) return { created: [], skipped: [] };

    const existingRows = await this.prisma.metafieldDefinition.findMany({
      where: {
        categoryId,
        OR: definitions.map((d) => ({ namespace: d.namespace, key: d.key })),
      },
      select: { namespace: true, key: true },
    });
    const existingKey = new Set(existingRows.map((r) => `${r.namespace}|${r.key}`));

    const toCreate: any[] = [];
    const skipped: any[] = [];
    for (const def of definitions) {
      if (existingKey.has(`${def.namespace}|${def.key}`)) {
        skipped.push({ ...def, reason: 'Already exists' });
      } else {
        toCreate.push(def);
      }
    }

    const created: any[] = [];
    if (toCreate.length > 0) {
      await this.prisma.$transaction(
        toCreate.map((def) =>
          this.prisma.metafieldDefinition.create({
            data: {
              namespace: def.namespace,
              key: def.key,
              name: def.name,
              description: def.description ?? null,
              type: def.type as any,
              choices: def.choices ?? Prisma.JsonNull,
              validations: def.validations ?? Prisma.JsonNull,
              ownerType: 'CATEGORY',
              categoryId,
              isRequired: def.isRequired ?? false,
              sortOrder: def.sortOrder ?? 0,
            },
          }),
        ),
      ).then((rows) => created.push(...rows));
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

  /**
   * Phase 39 (2026-05-21) — best-effort audit-log write. Mirrors the
   * category/brand/collection pattern. A failure here logs but never
   * propagates so an audit-log outage doesn't block a legitimate
   * mutation.
   */
  async writeAuditLog(entry: {
    metafieldDefinitionId: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'DEACTIVATE' | 'REACTIVATE' | 'BULK_ASSIGN';
    adminId?: string | null;
    previousState?: unknown;
    newState?: unknown;
    reason?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.metafieldDefinitionAuditLog.create({
        data: {
          metafieldDefinitionId: entry.metafieldDefinitionId,
          action: entry.action as MetafieldDefinitionAuditAction,
          adminId: entry.adminId ?? null,
          previousState: (entry.previousState ?? null) as any,
          newState: (entry.newState ?? null) as any,
          reason: entry.reason ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `MetafieldDefinitionAuditLog write failed for ${entry.metafieldDefinitionId} action=${entry.action}: ${(err as Error).message}`,
      );
    }
  }

  async findAuditLogForDefinition(
    definitionId: string,
    opts: { limit?: number; offset?: number },
  ): Promise<unknown[]> {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const skip = Math.max(opts.offset ?? 0, 0);
    return this.prisma.metafieldDefinitionAuditLog.findMany({
      where: { metafieldDefinitionId: definitionId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  /**
   * Phase 40 (2026-05-21) — toggle a definition's filterability with
   * the optional default-* overrides. Used by the new
   * PATCH /admin/metafield-definitions/:id/filterable endpoint.
   */
  async markDefinitionFilterable(
    id: string,
    payload: {
      isFilterable: boolean;
      defaultFilterType?: string | null;
      defaultFilterLabel?: string | null;
      filterDisplayOrder?: number;
    },
  ): Promise<unknown> {
    const data: any = { isFilterable: payload.isFilterable };
    if (payload.defaultFilterType !== undefined) data.defaultFilterType = payload.defaultFilterType;
    if (payload.defaultFilterLabel !== undefined) data.defaultFilterLabel = payload.defaultFilterLabel;
    if (payload.filterDisplayOrder !== undefined) data.filterDisplayOrder = payload.filterDisplayOrder;
    return this.prisma.metafieldDefinition.update({ where: { id }, data });
  }

  async bulkMarkDefinitionsFilterable(
    ids: string[],
    isFilterable: boolean,
  ): Promise<{ updated: number }> {
    if (ids.length === 0) return { updated: 0 };
    const result = await this.prisma.metafieldDefinition.updateMany({
      where: { id: { in: ids } },
      data: { isFilterable },
    });
    return { updated: result.count };
  }

  async findDefinitionByKeyForCategoryHierarchy(
    key: string,
    categoryIds: string[],
  ): Promise<unknown | null> {
    if (categoryIds.length === 0) return null;
    // Closest ancestor wins — ordered by the position of categoryId
    // in the input list (which getCategoryHierarchyIds returns from
    // leaf up). Prisma can't express that cleanly so we fetch all
    // matches and pick the first that matches the most specific
    // category in the chain.
    const rows = await this.prisma.metafieldDefinition.findMany({
      where: { key, isActive: true, ownerType: 'CATEGORY', categoryId: { in: categoryIds } },
    });
    if (rows.length === 0) return null;
    for (const cid of categoryIds) {
      const match = rows.find((r) => r.categoryId === cid);
      if (match) return match;
    }
    return rows[0];
  }
}
