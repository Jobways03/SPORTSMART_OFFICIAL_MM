import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../bootstrap/cache/redis.service';
import { MenuLinkType, StorefrontMenuItem } from '@prisma/client';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../core/exceptions';
import { MenuAuditService } from './menu-audit.service';

/**
 * Phase 48 (2026-05-21) — storefront menu service hardened.
 *
 * Changes vs. pre-Phase-48:
 *   - getMenuByHandle (public) filters isActive=true AND deletedAt=null
 *     across the menu AND its items, with effective active cascading
 *     down the tree (an inactive parent hides its descendants).
 *   - getPublicMenuByHandle returns a reduced PublicMenuTreeNode shape
 *     that omits linkType / linkRef / position — internal references
 *     are no longer leaked to the storefront.
 *   - Public read is cached in Redis (60s TTL, keyed by handle) and
 *     invalidated on every admin mutation that affects the menu.
 *   - createMenu catches Prisma P2002 → BadRequest with the offending
 *     handle name (was a generic 409 from the global filter).
 *   - createItem refuses position collisions at (menuId, parentId,
 *     position).
 *   - updateItem + reorderItems enforce: no cycle in the proposed
 *     ancestor chain; depth ≤ MAX_DEPTH (4).
 *   - deleteMenu + deleteItem are soft-deletes (deletedAt). Recovery
 *     via the audit log.
 *   - MenuAuditLog row written for every transition.
 */

export const STOREFRONT_MENU_CACHE_PREFIX = 'storefront-menu:v1:';
export const STOREFRONT_MENU_CACHE_TTL_SECONDS = 60;

/**
 * Phase 48 — public cap on menu depth. The storefront mobile nav
 * collapses past ~4 levels visually, and a 100-deep nested menu would
 * blow up the DOM. Reject any write that would push an item past
 * this depth. Counts the moved item itself, so MAX_DEPTH=4 means
 * up to 4 levels of nesting (root + 3 descendants).
 */
export const MAX_MENU_DEPTH = 4;

export interface MenuTreeNode {
  id: string;
  label: string;
  displayLabel: string | null;
  linkType: MenuLinkType;
  linkRef: string | null;
  href: string | null;
  filterTags: string[];
  position: number;
  isActive: boolean;
  openInNewTab: boolean;
  relNofollow: boolean;
  children: MenuTreeNode[];
}

export interface MenuTree {
  id: string;
  handle: string;
  name: string;
  isActive: boolean;
  items: MenuTreeNode[];
}

/**
 * Phase 48 — reduced shape returned to the storefront. linkType and
 * linkRef are admin-internal; the storefront only needs the computed
 * href + rendering hints.
 */
export interface PublicMenuTreeNode {
  id: string;
  label: string;
  href: string | null;
  filterTags: string[];
  openInNewTab: boolean;
  relNofollow: boolean;
  children: PublicMenuTreeNode[];
}

export interface PublicMenuTree {
  id: string;
  handle: string;
  name: string;
  items: PublicMenuTreeNode[];
}

@Injectable()
export class StorefrontMenuService {
  private readonly logger = new Logger(StorefrontMenuService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: MenuAuditService,
  ) {}

  // ─── public read ──────────────────────────────────────────────────

  async getPublicMenuByHandle(handle: string): Promise<PublicMenuTree> {
    return this.redis.getOrSet(
      `${STOREFRONT_MENU_CACHE_PREFIX}${handle}`,
      STOREFRONT_MENU_CACHE_TTL_SECONDS,
      () => this.loadPublicMenuByHandle(handle),
    );
  }

  private async loadPublicMenuByHandle(handle: string): Promise<PublicMenuTree> {
    const menu = await this.prisma.storefrontMenu.findUnique({
      where: { handle },
      include: {
        items: {
          where: { deletedAt: null },
          orderBy: [{ parentId: 'asc' }, { position: 'asc' }],
        },
      },
    });
    if (!menu || menu.deletedAt || !menu.isActive) {
      throw new NotFoundAppException(`Menu '${handle}' not found`);
    }
    const refs = await this.resolveRefs(menu.items);
    return {
      id: menu.id,
      handle: menu.handle,
      name: menu.name,
      items: this.buildPublicTree(menu.items, null, refs),
    };
  }

  // ─── admin reads ──────────────────────────────────────────────────

  async listMenus() {
    const menus = await this.prisma.storefrontMenu.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { items: { where: { deletedAt: null } } } } },
    });
    return menus.map((m) => ({
      id: m.id,
      handle: m.handle,
      name: m.name,
      isActive: m.isActive,
      itemCount: m._count.items,
      updatedAt: m.updatedAt,
    }));
  }

  async getMenuById(id: string): Promise<MenuTree> {
    const menu = await this.prisma.storefrontMenu.findUnique({
      where: { id },
      include: {
        items: {
          where: { deletedAt: null },
          orderBy: [{ parentId: 'asc' }, { position: 'asc' }],
        },
      },
    });
    if (!menu || menu.deletedAt) {
      throw new NotFoundAppException(`Menu '${id}' not found`);
    }
    const refs = await this.resolveRefs(menu.items);
    return {
      id: menu.id,
      handle: menu.handle,
      name: menu.name,
      isActive: menu.isActive,
      items: this.buildAdminTree(menu.items, null, refs),
    };
  }

  // ─── admin writes ─────────────────────────────────────────────────

  async createMenu(
    input: { handle: string; name: string },
    actorId?: string,
  ) {
    let row;
    try {
      row = await this.prisma.storefrontMenu.create({
        data: { handle: input.handle, name: input.name, createdById: actorId ?? null },
      });
    } catch (err: any) {
      // Pre-Phase-48 the global filter mapped this to a generic 409.
      // Marketing kept asking "which menu was the duplicate" — surface
      // the offending handle directly.
      if (err?.code === 'P2002') {
        throw new BadRequestAppException(
          `Menu handle '${input.handle}' already exists`,
        );
      }
      throw err;
    }
    await this.audit.record({
      resourceType: 'MENU',
      resourceId: row.id,
      action: 'CREATE',
      newState: { handle: row.handle, name: row.name, isActive: row.isActive },
      actorId,
    });
    await this.invalidateMenuCacheByHandle(row.handle);
    return row;
  }

  async updateMenu(
    id: string,
    input: { name?: string; handle?: string; isActive?: boolean },
    actorId?: string,
  ) {
    const before = await this.prisma.storefrontMenu.findUnique({ where: { id } });
    if (!before || before.deletedAt) {
      throw new NotFoundAppException(`Menu '${id}' not found`);
    }
    let row;
    try {
      row = await this.prisma.storefrontMenu.update({
        where: { id },
        data: { ...input, updatedById: actorId ?? null },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new BadRequestAppException(
          `Menu handle '${input.handle}' already exists`,
        );
      }
      throw err;
    }
    await this.audit.record({
      resourceType: 'MENU',
      resourceId: row.id,
      action: 'UPDATE',
      prevState: { handle: before.handle, name: before.name, isActive: before.isActive },
      newState: { handle: row.handle, name: row.name, isActive: row.isActive },
      actorId,
    });
    // Invalidate both old + new handle (in case it was renamed).
    await this.invalidateMenuCacheByHandle(before.handle);
    if (row.handle !== before.handle) {
      await this.invalidateMenuCacheByHandle(row.handle);
    }
    return row;
  }

  /** Soft-delete. Restore is via the audit log + a manual re-upsert. */
  async deleteMenu(id: string, actorId?: string) {
    const before = await this.prisma.storefrontMenu.findUnique({ where: { id } });
    if (!before || before.deletedAt) {
      throw new NotFoundAppException(`Menu '${id}' not found`);
    }
    await this.prisma.storefrontMenu.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedById: actorId ?? null },
    });
    await this.audit.record({
      resourceType: 'MENU',
      resourceId: id,
      action: 'DELETE',
      prevState: { handle: before.handle, name: before.name },
      actorId,
    });
    await this.invalidateMenuCacheByHandle(before.handle);
  }

  async createItem(
    menuId: string,
    input: {
      label: string;
      displayLabel?: string | null;
      linkType?: MenuLinkType;
      linkRef?: string | null;
      filterTags?: string[];
      parentId?: string | null;
      position?: number;
      isActive?: boolean;
      openInNewTab?: boolean;
      relNofollow?: boolean;
    },
    actorId?: string,
  ) {
    const menu = await this.prisma.storefrontMenu.findUnique({ where: { id: menuId } });
    if (!menu || menu.deletedAt) {
      throw new NotFoundAppException(`Menu '${menuId}' not found`);
    }

    // Verify parent belongs to the same menu (defense against cross-
    // menu mounting). Also computes depth-at-parent for the limit check.
    if (input.parentId) {
      const parent = await this.prisma.storefrontMenuItem.findUnique({
        where: { id: input.parentId },
      });
      if (!parent || parent.deletedAt || parent.menuId !== menuId) {
        throw new BadRequestAppException(
          `parentId '${input.parentId}' does not belong to menu '${menuId}'`,
        );
      }
      const parentDepth = await this.computeItemDepth(input.parentId);
      if (parentDepth + 1 >= MAX_MENU_DEPTH) {
        throw new BadRequestAppException(
          `Cannot create item: would exceed maximum depth of ${MAX_MENU_DEPTH}`,
        );
      }
    }

    // Phase 48 — position. If explicit, must not collide with an
    // existing live sibling. If absent, default to max+1.
    let position = input.position;
    if (position == null) {
      const maxRow = await this.prisma.storefrontMenuItem.aggregate({
        where: { menuId, parentId: input.parentId ?? null, deletedAt: null },
        _max: { position: true },
      });
      position = (maxRow._max.position ?? -1) + 1;
    } else {
      const clash = await this.prisma.storefrontMenuItem.findFirst({
        where: {
          menuId,
          parentId: input.parentId ?? null,
          position,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictAppException(
          `Slot (parent=${input.parentId ?? 'ROOT'}, position=${position}) is already occupied — use the reorder endpoint`,
        );
      }
    }

    const row = await this.prisma.storefrontMenuItem.create({
      data: {
        menuId,
        parentId: input.parentId ?? null,
        label: input.label,
        displayLabel: input.displayLabel ?? null,
        linkType: input.linkType ?? MenuLinkType.NONE,
        linkRef: input.linkRef ?? null,
        filterTags: input.filterTags ?? [],
        position,
        isActive: input.isActive ?? true,
        openInNewTab: input.openInNewTab ?? false,
        relNofollow: input.relNofollow ?? false,
      },
    });

    await this.audit.record({
      resourceType: 'MENU_ITEM',
      resourceId: row.id,
      action: 'CREATE',
      newState: this.toAuditSnapshot(row) as any,
      actorId,
    });
    await this.invalidateMenuCacheByHandle(menu.handle);
    return row;
  }

  async updateItem(
    itemId: string,
    input: {
      label?: string;
      displayLabel?: string | null;
      linkType?: MenuLinkType;
      linkRef?: string | null;
      filterTags?: string[];
      parentId?: string | null;
      position?: number;
      isActive?: boolean;
      openInNewTab?: boolean;
      relNofollow?: boolean;
    },
    actorId?: string,
  ) {
    const before = await this.prisma.storefrontMenuItem.findUnique({ where: { id: itemId } });
    if (!before || before.deletedAt) {
      throw new NotFoundAppException(`Menu item '${itemId}' not found`);
    }

    // Phase 48 — cycle + depth checks if parentId is changing.
    if (input.parentId !== undefined && input.parentId !== before.parentId) {
      if (input.parentId !== null) {
        const parent = await this.prisma.storefrontMenuItem.findUnique({
          where: { id: input.parentId },
        });
        if (!parent || parent.deletedAt || parent.menuId !== before.menuId) {
          throw new BadRequestAppException(
            `parentId '${input.parentId}' does not belong to menu '${before.menuId}'`,
          );
        }
        await this.assertNoCycle(itemId, input.parentId);
        const parentDepth = await this.computeItemDepth(input.parentId);
        if (parentDepth + 1 >= MAX_MENU_DEPTH) {
          throw new BadRequestAppException(
            `Cannot move item: would exceed maximum depth of ${MAX_MENU_DEPTH}`,
          );
        }
      }
    }

    const row = await this.prisma.storefrontMenuItem.update({
      where: { id: itemId },
      data: input,
    });

    await this.audit.record({
      resourceType: 'MENU_ITEM',
      resourceId: row.id,
      action: 'UPDATE',
      prevState: this.toAuditSnapshot(before) as any,
      newState: this.toAuditSnapshot(row) as any,
      actorId,
    });
    const menu = await this.prisma.storefrontMenu.findUnique({
      where: { id: row.menuId },
      select: { handle: true },
    });
    if (menu) await this.invalidateMenuCacheByHandle(menu.handle);
    return row;
  }

  /** Soft-delete. The cascade onDelete on FK does NOT fire (because
   * we don't run DELETE on the parent), so we also stamp deletedAt on
   * descendants in one pass. */
  async deleteItem(itemId: string, actorId?: string) {
    const before = await this.prisma.storefrontMenuItem.findUnique({ where: { id: itemId } });
    if (!before || before.deletedAt) {
      throw new NotFoundAppException(`Menu item '${itemId}' not found`);
    }
    const descendantIds = await this.collectDescendantIds(itemId);
    const ids = [itemId, ...descendantIds];
    await this.prisma.storefrontMenuItem.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.record({
      resourceType: 'MENU_ITEM',
      resourceId: itemId,
      action: 'DELETE',
      prevState: { ...this.toAuditSnapshot(before), descendantIds },
      actorId,
    });
    const menu = await this.prisma.storefrontMenu.findUnique({
      where: { id: before.menuId },
      select: { handle: true },
    });
    if (menu) await this.invalidateMenuCacheByHandle(menu.handle);
  }

  /**
   * Bulk reorder. Each entry assigns a new (parentId, position).
   *
   * Phase 48 — adds cycle + depth checks alongside the Phase 4.10
   * hardening:
   *   1. In-payload (parentId, position) collisions rejected
   *      pre-transaction.
   *   2. Every move id must belong to this menu.
   *   3. For each move that changes parentId, walk the proposed
   *      ancestor chain — reject if it would create a cycle or
   *      exceed MAX_MENU_DEPTH.
   *   4. Updates run inside a transaction so partial reorder rolls
   *      back.
   */
  async reorderItems(
    menuId: string,
    moves: Array<{ id: string; parentId: string | null; position: number }>,
    actorId?: string,
  ) {
    if (moves.length === 0) return this.getMenuById(menuId);

    const slotKey = (parentId: string | null, position: number) =>
      `${parentId ?? 'ROOT'}:${position}`;
    const slots = new Map<string, string>();
    for (const m of moves) {
      const key = slotKey(m.parentId, m.position);
      const existing = slots.get(key);
      if (existing) {
        throw new BadRequestAppException(
          `Reorder collision: items ${existing} and ${m.id} both target (parent=${m.parentId ?? 'ROOT'}, position=${m.position})`,
        );
      }
      slots.set(key, m.id);
    }

    // Phase 48 — pre-transaction cycle + depth checks. We do these
    // outside the transaction because they hit the DB read-only.
    for (const m of moves) {
      if (m.parentId !== null) {
        await this.assertNoCycle(m.id, m.parentId);
        const parentDepth = await this.computeItemDepth(m.parentId);
        if (parentDepth + 1 >= MAX_MENU_DEPTH) {
          throw new BadRequestAppException(
            `Reorder would place item ${m.id} past the maximum depth of ${MAX_MENU_DEPTH}`,
          );
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const ids = moves.map((m) => m.id);
      const existing = await tx.storefrontMenuItem.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, menuId: true },
      });
      if (existing.length !== ids.length) {
        throw new BadRequestAppException(
          `Reorder references ${ids.length - existing.length} unknown menu item(s)`,
        );
      }
      const foreign = existing.find((e) => e.menuId !== menuId);
      if (foreign) {
        throw new BadRequestAppException(
          `Menu item ${foreign.id} does not belong to menu ${menuId}`,
        );
      }
      for (const m of moves) {
        await tx.storefrontMenuItem.update({
          where: { id: m.id },
          data: { parentId: m.parentId, position: m.position },
        });
      }
    });

    await this.audit.record({
      resourceType: 'MENU',
      resourceId: menuId,
      action: 'REORDER',
      newState: { moves },
      actorId,
    });
    const menu = await this.prisma.storefrontMenu.findUnique({
      where: { id: menuId },
      select: { handle: true },
    });
    if (menu) await this.invalidateMenuCacheByHandle(menu.handle);

    return this.getMenuById(menuId);
  }

  // ─── cache helpers ────────────────────────────────────────────────

  async invalidateMenuCacheByHandle(handle: string): Promise<void> {
    try {
      await this.redis.del(`${STOREFRONT_MENU_CACHE_PREFIX}${handle}`);
    } catch (err) {
      this.logger.warn(
        `Menu cache invalidation failed for ${handle}: ${(err as Error).message}`,
      );
    }
  }

  // ─── invariant helpers ────────────────────────────────────────────

  /**
   * Walk the ancestor chain of `newParentId`. If `itemId` appears
   * anywhere in the chain (including newParentId itself), the move
   * would create a cycle. Throws BadRequestAppException on cycle.
   *
   * MAX_MENU_DEPTH bounds the walk so a corrupted DB row can't
   * infinite-loop us.
   */
  private async assertNoCycle(itemId: string, newParentId: string): Promise<void> {
    if (itemId === newParentId) {
      throw new BadRequestAppException(
        `Cannot move item ${itemId} under itself`,
      );
    }
    let cursor: string | null = newParentId;
    let safetyHops = MAX_MENU_DEPTH + 8;
    while (cursor != null && safetyHops-- > 0) {
      if (cursor === itemId) {
        throw new BadRequestAppException(
          `Move would create a cycle: item ${itemId} appears in its proposed ancestor chain`,
        );
      }
      const next: { parentId: string | null } | null =
        await this.prisma.storefrontMenuItem.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      if (!next) return;
      cursor = next.parentId;
    }
  }

  /**
   * Returns the 0-indexed depth of `itemId` (depth=0 means a root
   * item with parentId=null). Walks up the tree.
   */
  private async computeItemDepth(itemId: string): Promise<number> {
    let depth = 0;
    let cursor: string | null = itemId;
    let safetyHops = MAX_MENU_DEPTH + 8;
    while (cursor != null && safetyHops-- > 0) {
      const next: { parentId: string | null } | null =
        await this.prisma.storefrontMenuItem.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      if (!next) break;
      cursor = next.parentId;
      if (cursor != null) depth += 1;
    }
    return depth;
  }

  /**
   * BFS collect of descendant item IDs for a soft-delete cascade.
   */
  private async collectDescendantIds(rootId: string): Promise<string[]> {
    const out: string[] = [];
    const frontier: string[] = [rootId];
    while (frontier.length > 0) {
      const layer = frontier.splice(0, frontier.length);
      const children = await this.prisma.storefrontMenuItem.findMany({
        where: { parentId: { in: layer }, deletedAt: null },
        select: { id: true },
      });
      for (const c of children) {
        out.push(c.id);
        frontier.push(c.id);
      }
    }
    return out;
  }

  // ─── tree builders ────────────────────────────────────────────────

  /** Admin tree: full shape including linkType/linkRef. Includes
   * isActive=false rows so the admin can toggle them. */
  private buildAdminTree(
    items: StorefrontMenuItem[],
    parentId: string | null,
    refs: ResolvedRefs,
  ): MenuTreeNode[] {
    return items
      .filter((i) => i.parentId === parentId)
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        id: i.id,
        label: i.label,
        displayLabel: i.displayLabel,
        linkType: i.linkType,
        linkRef: i.linkRef,
        href: this.computeHref(i, refs),
        filterTags: i.filterTags,
        position: i.position,
        isActive: i.isActive,
        openInNewTab: i.openInNewTab,
        relNofollow: i.relNofollow,
        children: this.buildAdminTree(items, i.id, refs),
      }));
  }

  /** Public tree: reduced shape, filters out isActive=false items.
   * The "effective active" rule (an inactive parent hides its
   * descendants) is enforced by recursion — we never enter the
   * children branch of an inactive parent. */
  private buildPublicTree(
    items: StorefrontMenuItem[],
    parentId: string | null,
    refs: ResolvedRefs,
  ): PublicMenuTreeNode[] {
    return items
      .filter((i) => i.parentId === parentId && i.isActive)
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        id: i.id,
        label: i.displayLabel ?? i.label,
        href: this.computeHref(i, refs),
        filterTags: i.filterTags,
        openInNewTab: i.openInNewTab,
        relNofollow: i.relNofollow,
        children: this.buildPublicTree(items, i.id, refs),
      }));
  }

  private async resolveRefs(items: StorefrontMenuItem[]): Promise<ResolvedRefs> {
    const ids = {
      collections: new Set<string>(),
      categories: new Set<string>(),
      brands: new Set<string>(),
      products: new Set<string>(),
    };
    for (const i of items) {
      if (!i.linkRef) continue;
      if (i.linkType === MenuLinkType.COLLECTION) ids.collections.add(i.linkRef);
      else if (i.linkType === MenuLinkType.CATEGORY) ids.categories.add(i.linkRef);
      else if (i.linkType === MenuLinkType.BRAND) ids.brands.add(i.linkRef);
      else if (i.linkType === MenuLinkType.PRODUCT) ids.products.add(i.linkRef);
    }
    const [collections, categories, brands, products] = await Promise.all([
      ids.collections.size
        ? this.prisma.productCollection.findMany({
            where: { id: { in: Array.from(ids.collections) } },
            select: { id: true, slug: true },
          })
        : Promise.resolve([]),
      ids.categories.size
        ? this.prisma.category.findMany({
            where: { id: { in: Array.from(ids.categories) } },
            select: { id: true, slug: true },
          })
        : Promise.resolve([]),
      ids.brands.size
        ? this.prisma.brand.findMany({
            where: { id: { in: Array.from(ids.brands) } },
            select: { id: true, slug: true },
          })
        : Promise.resolve([]),
      ids.products.size
        ? this.prisma.product.findMany({
            where: { id: { in: Array.from(ids.products) } },
            select: { id: true, slug: true },
          })
        : Promise.resolve([]),
    ]);
    return {
      collections: new Map(collections.map((c) => [c.id, c.slug])),
      categories: new Map(categories.map((c) => [c.id, c.slug])),
      brands: new Map(brands.map((b) => [b.id, b.slug])),
      products: new Map(products.map((p) => [p.id, p.slug])),
    };
  }

  private computeHref(i: StorefrontMenuItem, refs: ResolvedRefs): string | null {
    if (!i.linkRef) return null;
    const tagSuffix =
      i.filterTags.length > 0 ? `?tags=${encodeURIComponent(i.filterTags.join(','))}` : '';
    switch (i.linkType) {
      case MenuLinkType.URL:
        // Phase 48 — defence-in-depth. The DTO already rejects
        // javascript:/data:/protocol-relative URLs, but a row inserted
        // pre-Phase-48 could carry an unsafe value. Reject those at
        // render time as well.
        if (this.isUnsafeHref(i.linkRef)) return null;
        return i.linkRef;
      case MenuLinkType.PAGE:
        return `/pages/${i.linkRef}`;
      case MenuLinkType.COLLECTION: {
        const slug = refs.collections.get(i.linkRef);
        return slug ? `/collections/${slug}${tagSuffix}` : null;
      }
      case MenuLinkType.CATEGORY: {
        const slug = refs.categories.get(i.linkRef);
        return slug ? `/products?category=${slug}` : null;
      }
      case MenuLinkType.BRAND: {
        const slug = refs.brands.get(i.linkRef);
        return slug ? `/products?brand=${slug}` : null;
      }
      case MenuLinkType.PRODUCT: {
        const slug = refs.products.get(i.linkRef);
        return slug ? `/products/${slug}` : null;
      }
      default:
        return null;
    }
  }

  private isUnsafeHref(href: string): boolean {
    const lower = href.trim().toLowerCase();
    if (lower.startsWith('javascript:')) return true;
    if (lower.startsWith('data:')) return true;
    if (lower.startsWith('vbscript:')) return true;
    if (lower.startsWith('//')) return true;
    return false;
  }

  private toAuditSnapshot(row: StorefrontMenuItem): Record<string, unknown> {
    return {
      id: row.id,
      menuId: row.menuId,
      parentId: row.parentId,
      label: row.label,
      displayLabel: row.displayLabel,
      linkType: row.linkType,
      linkRef: row.linkRef,
      filterTags: row.filterTags,
      position: row.position,
      isActive: row.isActive,
      openInNewTab: row.openInNewTab,
      relNofollow: row.relNofollow,
    };
  }
}

interface ResolvedRefs {
  collections: Map<string, string>;
  categories: Map<string, string>;
  brands: Map<string, string>;
  products: Map<string, string>;
}
