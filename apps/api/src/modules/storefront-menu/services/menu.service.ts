import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { MenuLinkType, StorefrontMenuItem } from '@prisma/client';
import { NotFoundAppException } from '../../../core/exceptions';

export interface MenuTreeNode {
  id: string;
  label: string;
  linkType: MenuLinkType;
  linkRef: string | null;
  /** Pre-resolved href ready for the storefront. Null only when linkType=NONE. */
  href: string | null;
  filterTags: string[];
  position: number;
  children: MenuTreeNode[];
}

export interface MenuTree {
  id: string;
  handle: string;
  name: string;
  items: MenuTreeNode[];
}

@Injectable()
export class StorefrontMenuService {
  constructor(private readonly prisma: PrismaService) {}

  async getMenuByHandle(handle: string): Promise<MenuTree> {
    const menu = await this.prisma.storefrontMenu.findUnique({
      where: { handle },
      include: {
        items: { orderBy: [{ parentId: 'asc' }, { position: 'asc' }] },
      },
    });
    if (!menu) {
      throw new NotFoundAppException(`Menu '${handle}' not found`);
    }
    const refs = await this.resolveRefs(menu.items);
    return {
      id: menu.id,
      handle: menu.handle,
      name: menu.name,
      items: this.buildTree(menu.items, null, refs),
    };
  }

  async listMenus() {
    const menus = await this.prisma.storefrontMenu.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { items: true } } },
    });
    return menus.map((m) => ({
      id: m.id,
      handle: m.handle,
      name: m.name,
      itemCount: m._count.items,
      updatedAt: m.updatedAt,
    }));
  }

  async getMenuById(id: string): Promise<MenuTree> {
    const menu = await this.prisma.storefrontMenu.findUnique({
      where: { id },
      include: {
        items: { orderBy: [{ parentId: 'asc' }, { position: 'asc' }] },
      },
    });
    if (!menu) {
      throw new NotFoundAppException(`Menu '${id}' not found`);
    }
    const refs = await this.resolveRefs(menu.items);
    return {
      id: menu.id,
      handle: menu.handle,
      name: menu.name,
      items: this.buildTree(menu.items, null, refs),
    };
  }

  async createMenu(input: { handle: string; name: string }) {
    return this.prisma.storefrontMenu.create({
      data: { handle: input.handle, name: input.name },
    });
  }

  async updateMenu(id: string, input: { name?: string; handle?: string }) {
    return this.prisma.storefrontMenu.update({ where: { id }, data: input });
  }

  async deleteMenu(id: string) {
    await this.prisma.storefrontMenu.delete({ where: { id } });
  }

  async createItem(
    menuId: string,
    input: {
      label: string;
      linkType?: MenuLinkType;
      linkRef?: string | null;
      filterTags?: string[];
      parentId?: string | null;
      position?: number;
    },
  ) {
    // Default position = max + 1 within siblings
    let position = input.position;
    if (position == null) {
      const maxRow = await this.prisma.storefrontMenuItem.aggregate({
        where: { menuId, parentId: input.parentId ?? null },
        _max: { position: true },
      });
      position = (maxRow._max.position ?? -1) + 1;
    }
    return this.prisma.storefrontMenuItem.create({
      data: {
        menuId,
        parentId: input.parentId ?? null,
        label: input.label,
        linkType: input.linkType ?? MenuLinkType.NONE,
        linkRef: input.linkRef ?? null,
        filterTags: input.filterTags ?? [],
        position,
      },
    });
  }

  async updateItem(
    itemId: string,
    input: {
      label?: string;
      linkType?: MenuLinkType;
      linkRef?: string | null;
      filterTags?: string[];
      parentId?: string | null;
      position?: number;
    },
  ) {
    return this.prisma.storefrontMenuItem.update({
      where: { id: itemId },
      data: input,
    });
  }

  async deleteItem(itemId: string) {
    await this.prisma.storefrontMenuItem.delete({ where: { id: itemId } });
  }

  /** Bulk reorder. Each entry assigns a new (parentId, position). */
  async reorderItems(
    menuId: string,
    moves: Array<{ id: string; parentId: string | null; position: number }>,
  ) {
    await this.prisma.$transaction(
      moves.map((m) =>
        this.prisma.storefrontMenuItem.update({
          where: { id: m.id },
          data: { parentId: m.parentId, position: m.position },
        }),
      ),
    );
    return this.getMenuById(menuId);
  }

  private buildTree(
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
        linkType: i.linkType,
        linkRef: i.linkRef,
        href: this.computeHref(i, refs),
        filterTags: i.filterTags,
        position: i.position,
        children: this.buildTree(items, i.id, refs),
      }));
  }

  /** Resolve all entity-typed link refs to their public-facing slugs in one batch. */
  private async resolveRefs(items: StorefrontMenuItem[]): Promise<ResolvedRefs> {
    const ids = { collections: new Set<string>(), categories: new Set<string>(), brands: new Set<string>(), products: new Set<string>() };
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
}

interface ResolvedRefs {
  collections: Map<string, string>;
  categories: Map<string, string>;
  brands: Map<string, string>;
  products: Map<string, string>;
}
