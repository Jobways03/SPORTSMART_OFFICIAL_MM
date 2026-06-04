import { Injectable, Logger } from '@nestjs/common';
import { CategoryAuditAction } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { ICategoryRepository, CategoryListParams } from '../../domain/repositories/category.repository.interface';

@Injectable()
export class PrismaCategoryRepository implements ICategoryRepository {
  private readonly logger = new Logger(PrismaCategoryRepository.name);

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

  /**
   * Phase 33 (2026-05-21) — re-parent + level cascade.
   *
   * Pre-Phase-33 `update()` set only the moved category's `level` to
   * `parent.level + 1`, leaving descendants at their old level.
   * After "Cricket Bats" (was L1 under Cricket-Equipment) moves to
   * "Bats & Balls" (also L1), Cricket Bats becomes L2 — but its
   * existing children stayed at L2 instead of L3. The flat indented
   * admin UI renders them at the wrong depth; the storefront tree
   * potentially hides them.
   *
   * The fix walks descendants via parentId pointers inside the same
   * transaction. Practical max depth ~5; we cap at 10 as a safety
   * net so a cycle-creating mistake doesn't loop forever (the cycle
   * check at the controller layer is the real guard, this is
   * defence-in-depth).
   */
  async updateWithLevelCascade(
    id: string,
    data: any,
    newLevel: number,
  ): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Apply the update on the moved category.
      const updated = await tx.category.update({
        where: { id },
        data: { ...data, level: newLevel },
        include: {
          parent: { select: { id: true, name: true, slug: true } },
          _count: { select: { products: true, children: true, metafieldDefinitions: true } },
        },
      });

      // 2. BFS through descendants, stamping new level = parentLevel + 1.
      //    Each iteration fetches the current frontier's children and
      //    updates them in one updateMany per depth band.
      let frontier: Array<{ id: string; level: number }> = [
        { id, level: newLevel },
      ];
      let depth = 0;
      while (frontier.length > 0 && depth < 10) {
        const children = await tx.category.findMany({
          where: { parentId: { in: frontier.map((f) => f.id) } },
          select: { id: true, parentId: true },
        });
        if (children.length === 0) break;
        // Group children by their current parent's new level + 1.
        const targetLevel = frontier[0]!.level + 1;
        await tx.category.updateMany({
          where: { id: { in: children.map((c) => c.id) } },
          data: { level: targetLevel },
        });
        frontier = children.map((c) => ({ id: c.id, level: targetLevel }));
        depth += 1;
      }

      return updated;
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.category.delete({ where: { id } });
  }

  /**
   * Phase 33 (2026-05-21) — transactional delete. Counts re-checked
   * inside the same tx as the delete itself; a child or product
   * created between the controller's pre-check and the delete is
   * now caught (the inner check throws, and the entire tx rolls back).
   * Returns the deleted row's image fields so the caller can fire
   * media cleanup on the publicIds.
   */
  async deleteTransactional(
    id: string,
  ): Promise<{ imageUrl: string | null; bannerUrl: string | null } | null> {
    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.category.findUnique({
        where: { id },
        select: {
          id: true,
          imageUrl: true,
          bannerUrl: true,
          _count: { select: { products: true, children: true } },
        },
      });
      if (!fresh) return null;
      if (fresh._count.products > 0 || fresh._count.children > 0) {
        // Reuses the message contract the controller already has; the
        // controller catches this and surfaces it as a 400.
        throw new Error('CATEGORY_NOT_EMPTY');
      }
      await tx.category.delete({ where: { id } });
      return { imageUrl: fresh.imageUrl, bannerUrl: fresh.bannerUrl };
    });
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

  /**
   * Phase 33 (2026-05-21) — unlimited-depth tree assembly.
   *
   * Pre-Phase-33 we used a nested `include` two levels deep, which
   * hard-capped the storefront tree at 3 levels (root → child →
   * grandchild). The schema supports unlimited depth; the old query
   * silently dropped L3+ categories from the storefront menu — a
   * latent footgun for any future taxonomy expansion.
   *
   * Now: a single flat SELECT of every active row (currently ~352
   * rows; well within a single round-trip) and a JS pass to assemble
   * the tree by parentId pointers. Each node gets a `children` array
   * just like the old include shape, so consumers don't need to
   * change.
   */
  async findActiveTree(): Promise<any[]> {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
    });
    type Node = (typeof rows)[number] & { children: Node[] };
    const byId = new Map<string, Node>();
    for (const r of rows) {
      byId.set(r.id, { ...r, children: [] });
    }
    const roots: Node[] = [];
    for (const r of rows) {
      const node = byId.get(r.id)!;
      if (r.parentId && byId.has(r.parentId)) {
        byId.get(r.parentId)!.children.push(node);
      } else {
        // parentId is null OR parent is inactive (filtered out): treat
        // as a storefront root. Pre-Phase-33 the parent-active filter
        // was implicit in the nested include; the flat fetch above
        // gives the same semantics (only active rows, orphans surface).
        roots.push(node);
      }
    }
    return roots;
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

  /**
   * Phase 34 (2026-05-21) — best-effort audit-log write. A failure
   * here logs and returns; the primary mutation has already committed
   * by the time we get called. The audit table is a mirror, not the
   * source of truth.
   */
  async writeAuditLog(entry: {
    categoryId: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'DEACTIVATE' | 'REORDER';
    adminId?: string | null;
    previousState?: unknown;
    newState?: unknown;
    reason?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.categoryAuditLog.create({
        data: {
          categoryId: entry.categoryId,
          action: entry.action as CategoryAuditAction,
          adminId: entry.adminId ?? null,
          previousState: (entry.previousState ?? null) as any,
          newState: (entry.newState ?? null) as any,
          reason: entry.reason ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `CategoryAuditLog write failed for ${entry.categoryId} action=${entry.action}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Phase 34 (2026-05-21) — bulk-update siblings' sortOrder. The
   * caller (controller) has already verified every id exists and all
   * share the same parentId; here we just churn the values in a
   * single transaction so a partial failure rolls back cleanly.
   */
  async bulkReorder(updates: Array<{ id: string; sortOrder: number }>): Promise<void> {
    if (updates.length === 0) return;
    await this.prisma.$transaction(
      updates.map((u) =>
        this.prisma.category.update({
          where: { id: u.id },
          data: { sortOrder: u.sortOrder },
        }),
      ),
    );
  }

  /**
   * Phase 34 (2026-05-21) — paginated audit log for one category.
   * Sorted newest-first since the moderator view always wants "what
   * just changed" at the top.
   */
  async findAuditLogForCategory(
    categoryId: string,
    opts: { limit?: number; offset?: number },
  ): Promise<unknown[]> {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const skip = Math.max(opts.offset ?? 0, 0);
    return this.prisma.categoryAuditLog.findMany({
      where: { categoryId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }
}
