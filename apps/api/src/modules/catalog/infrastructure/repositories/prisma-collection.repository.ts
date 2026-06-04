import { Injectable, Logger } from '@nestjs/common';
import { CollectionAuditAction } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  AttachProductsResult,
  ICollectionRepository,
  CollectionListParams,
} from '../../domain/repositories/collection.repository.interface';

@Injectable()
export class PrismaCollectionRepository implements ICollectionRepository {
  private readonly logger = new Logger(PrismaCollectionRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAllPaginated(params: CollectionListParams): Promise<{ collections: any[]; total: number }> {
    const { page, limit, search, includeDeleted } = params;
    const where: any = {};
    if (!includeDeleted) where.deletedAt = null;
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
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productCollection.count({ where }),
    ]);
    return { collections, total };
  }

  async findById(id: string): Promise<any | null> {
    return this.prisma.productCollection.findUnique({
      where: { id },
      include: {
        products: {
          include: {
            product: {
              select: {
                id: true, title: true, slug: true, status: true, basePrice: true,
                images: { where: { isPrimary: true }, select: { url: true }, take: 1 },
              },
            },
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
  }

  async findBySlug(slug: string): Promise<any | null> {
    return this.prisma.productCollection.findUnique({ where: { slug } });
  }

  /**
   * Phase 37 (2026-05-21) — case-insensitive name uniqueness check
   * with optional self-exclusion (for the update path). Filters out
   * soft-deleted rows so renaming back to a freed name works.
   */
  async findByNameInsensitiveExcluding(
    name: string,
    excludeId?: string,
  ): Promise<any | null> {
    return this.prisma.productCollection.findFirst({
      where: {
        name: { equals: name.trim(), mode: 'insensitive' },
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  async create(data: any): Promise<any> {
    return this.prisma.productCollection.create({ data });
  }

  async update(id: string, data: any): Promise<any> {
    return this.prisma.productCollection.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.productCollection.delete({ where: { id } });
  }

  /**
   * Phase 37 (2026-05-21) — soft-delete. Stamps deletedAt + cascades
   * map removal in one tx. Returns image fields so the controller
   * can fire media cleanup.
   */
  async softDelete(id: string): Promise<{
    imageUrl: string | null;
    imagePublicId: string | null;
  } | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.productCollection.findUnique({
        where: { id },
        select: { id: true, imageUrl: true, imagePublicId: true, deletedAt: true },
      });
      if (!existing || existing.deletedAt) return null;
      await tx.productCollectionMap.deleteMany({ where: { collectionId: id } });
      await tx.productCollection.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      return { imageUrl: existing.imageUrl, imagePublicId: existing.imagePublicId };
    });
  }

  async restore(id: string): Promise<any | null> {
    const existing = await this.prisma.productCollection.findUnique({
      where: { id },
      select: { deletedAt: true },
    });
    if (!existing || !existing.deletedAt) return null;
    return this.prisma.productCollection.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });
  }

  /**
   * Phase 37 (2026-05-21) — eligibility-filtered attach. Products
   * must be: not soft-deleted, status = ACTIVE, moderationStatus =
   * APPROVED. Anything else lands in `skipped` with a reason the UI
   * can surface ("X attached, 2 skipped — Y is DRAFT, Z is REJECTED").
   *
   * Pre-Phase-37 any productId went straight into the join table
   * regardless of status, leading to "admin sees 12 in panel,
   * customer sees 8 on storefront" UX confusion.
   */
  async addProducts(collectionId: string, productIds: string[]): Promise<AttachProductsResult> {
    const unique = Array.from(new Set(productIds));
    if (unique.length === 0) return { attached: [], skipped: [] };

    const [candidates, alreadyAttached] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: unique } },
        select: { id: true, status: true, moderationStatus: true, isDeleted: true },
      }),
      this.prisma.productCollectionMap.findMany({
        where: { collectionId, productId: { in: unique } },
        select: { productId: true },
      }),
    ]);

    const candidateMap = new Map(candidates.map((c) => [c.id, c]));
    const attachedSet = new Set(alreadyAttached.map((a) => a.productId));

    const skipped: AttachProductsResult['skipped'] = [];
    const toAttach: string[] = [];

    for (const productId of unique) {
      if (attachedSet.has(productId)) {
        skipped.push({ productId, reason: 'already_attached' });
        continue;
      }
      const cand = candidateMap.get(productId);
      if (!cand) {
        skipped.push({ productId, reason: 'not_found' });
        continue;
      }
      if (cand.isDeleted) {
        skipped.push({ productId, reason: 'deleted' });
        continue;
      }
      if (cand.status !== 'ACTIVE') {
        skipped.push({ productId, reason: `not_active (${cand.status})` });
        continue;
      }
      if (cand.moderationStatus !== 'APPROVED') {
        skipped.push({ productId, reason: `not_approved (${cand.moderationStatus})` });
        continue;
      }
      toAttach.push(productId);
    }

    if (toAttach.length > 0) {
      await this.prisma.productCollectionMap.createMany({
        data: toAttach.map((productId) => ({ productId, collectionId })),
      });
    }

    return { attached: toAttach, skipped };
  }

  async removeProduct(collectionId: string, productId: string): Promise<void> {
    await this.prisma.productCollectionMap.deleteMany({
      where: { collectionId, productId },
    });
  }

  async removeProducts(collectionId: string, productIds: string[]): Promise<number> {
    if (productIds.length === 0) return 0;
    const res = await this.prisma.productCollectionMap.deleteMany({
      where: { collectionId, productId: { in: productIds } },
    });
    return res.count;
  }

  async reorderProducts(
    collectionId: string,
    items: Array<{ productId: string; sortOrder: number }>,
  ): Promise<void> {
    if (items.length === 0) return;
    await this.prisma.$transaction(
      items.map((it) =>
        this.prisma.productCollectionMap.updateMany({
          where: { collectionId, productId: it.productId },
          data: { sortOrder: it.sortOrder },
        }),
      ),
    );
  }

  async updateImageUrl(id: string, imageUrl: string | null): Promise<any> {
    return this.prisma.productCollection.update({ where: { id }, data: { imageUrl } });
  }

  /**
   * Phase 37 (2026-05-21) — atomic image url + publicId. Same pattern
   * as Phase 35 brand logo handling.
   */
  async updateImageFields(
    id: string,
    imageUrl: string | null,
    imagePublicId: string | null,
  ): Promise<any> {
    return this.prisma.productCollection.update({
      where: { id },
      data: { imageUrl, imagePublicId },
    });
  }

  async writeAuditLog(entry: {
    collectionId: string;
    action:
      | 'CREATE'
      | 'UPDATE'
      | 'DELETE'
      | 'RESTORE'
      | 'IMAGE_CHANGE'
      | 'ATTACH'
      | 'DETACH'
      | 'REORDER';
    adminId?: string | null;
    previousState?: unknown;
    newState?: unknown;
    reason?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.collectionAuditLog.create({
        data: {
          collectionId: entry.collectionId,
          action: entry.action as CollectionAuditAction,
          adminId: entry.adminId ?? null,
          previousState: (entry.previousState ?? null) as any,
          newState: (entry.newState ?? null) as any,
          reason: entry.reason ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `CollectionAuditLog write failed for ${entry.collectionId} action=${entry.action}: ${(err as Error).message}`,
      );
    }
  }

  async findAuditLogForCollection(
    collectionId: string,
    opts: { limit?: number; offset?: number },
  ): Promise<unknown[]> {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const skip = Math.max(opts.offset ?? 0, 0);
    return this.prisma.collectionAuditLog.findMany({
      where: { collectionId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  /**
   * Phase 37 (2026-05-21) — paginated storefront list. Pre-Phase-37
   * `findAllActive` returned everything unbounded — fine at 15
   * collections, painful at 200+.
   */
  async findAllActivePaginated(
    page: number,
    limit: number,
  ): Promise<{ collections: any[]; total: number }> {
    const where = { isActive: true, deletedAt: null };
    const [collections, total] = await Promise.all([
      this.prisma.productCollection.findMany({
        where,
        include: { _count: { select: { products: true } } },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productCollection.count({ where }),
    ]);
    return { collections, total };
  }

  async findAllActive(): Promise<any[]> {
    return this.prisma.productCollection.findMany({
      where: { isActive: true, deletedAt: null },
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findBySlugWithProducts(slug: string, page: number, limit: number): Promise<any | null> {
    const collection = await this.prisma.productCollection.findUnique({ where: { slug } });
    if (!collection || !collection.isActive || collection.deletedAt) return null;

    const where = {
      collectionId: collection.id,
      product: {
        status: 'ACTIVE' as const,
        isDeleted: false,
        moderationStatus: 'APPROVED' as const,
      },
    };

    const [maps, total] = await Promise.all([
      this.prisma.productCollectionMap.findMany({
        where,
        include: {
          product: {
            select: {
              id: true, title: true, slug: true, shortDescription: true,
              basePrice: true, compareAtPrice: true,
              images: { where: { isPrimary: true }, select: { url: true, altText: true }, take: 1 },
              variants: {
                where: { isDeleted: false, status: 'ACTIVE' as const, stock: { gt: 0 } },
                select: { price: true, compareAtPrice: true, stock: true },
                orderBy: { price: 'asc' }, take: 1,
              },
              category: { select: { name: true } },
              brand: { select: { name: true } },
              seller: { select: { sellerShopName: true } },
            },
          },
        },
        // Phase 37 (2026-05-21) — explicit sortOrder ordering;
        // ties broken by attach-time so legacy rows behave as before.
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productCollectionMap.count({ where }),
    ]);

    return { collection, maps, total };
  }
}
