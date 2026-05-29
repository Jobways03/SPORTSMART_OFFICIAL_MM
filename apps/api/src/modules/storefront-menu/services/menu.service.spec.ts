/**
 * Phase 48 (2026-05-21) — pins the security-relevant behaviour the
 * audit flagged:
 *   - createMenu translates Prisma P2002 → handle-specific 400
 *     (was generic 409 via global filter).
 *   - createItem refuses (parentId, position) collisions.
 *   - updateItem catches cycles + enforces depth ≤ MAX_MENU_DEPTH.
 *   - deleteMenu / deleteItem are soft-deletes (deletedAt stamp).
 *   - getPublicMenuByHandle returns a reduced shape (no linkType /
 *     linkRef) and filters out isActive=false items.
 *   - The Cloudinary-equivalent here: cache invalidation on every
 *     write path.
 */

import { MenuLinkType } from '@prisma/client';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../core/exceptions';
import { StorefrontMenuService } from './menu.service';

function baseItem(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'item-1',
    menuId: 'menu-1',
    parentId: null,
    position: 0,
    label: 'L',
    displayLabel: null,
    linkType: MenuLinkType.NONE,
    linkRef: null,
    filterTags: [],
    isActive: true,
    deletedAt: null,
    openInNewTab: false,
    relNofollow: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function baseMenu(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'menu-1',
    handle: 'main-menu',
    name: 'Main Menu',
    isActive: true,
    deletedAt: null,
    createdById: null,
    updatedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeService() {
  const storefrontMenu = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
  };
  const storefrontMenuItem = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    aggregate: jest.fn().mockResolvedValue({ _max: { position: null } }),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const productCollection = { findMany: jest.fn().mockResolvedValue([]) };
  const category = { findMany: jest.fn().mockResolvedValue([]) };
  const brand = { findMany: jest.fn().mockResolvedValue([]) };
  const product = { findMany: jest.fn().mockResolvedValue([]) };
  const prisma: any = {
    storefrontMenu,
    storefrontMenuItem,
    productCollection,
    category,
    brand,
    product,
    $transaction: jest.fn(async (fn: any) => fn({ storefrontMenuItem })),
  };
  const redis = {
    del: jest.fn().mockResolvedValue(undefined),
    getOrSet: jest.fn(async (_k: string, _ttl: number, factory: () => Promise<unknown>) => factory()),
  } as any;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new StorefrontMenuService(prisma, redis, audit);
  return { service, prisma, storefrontMenu, storefrontMenuItem, redis, audit };
}

describe('StorefrontMenuService.createMenu (Phase 48)', () => {
  it('catches Prisma P2002 → BadRequest with handle name', async () => {
    const { service, storefrontMenu } = makeService();
    const p2002 = Object.assign(new Error('unique'), { code: 'P2002' });
    storefrontMenu.create.mockRejectedValue(p2002);

    await expect(
      service.createMenu({ handle: 'main-menu', name: 'Main' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    await expect(
      service.createMenu({ handle: 'main-menu', name: 'Main' }),
    ).rejects.toThrow(/main-menu/);
  });

  it('writes a CREATE audit row + invalidates cache', async () => {
    const { service, storefrontMenu, audit, redis } = makeService();
    storefrontMenu.create.mockResolvedValueOnce(baseMenu());

    await service.createMenu({ handle: 'main-menu', name: 'Main' }, 'admin-7');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'MENU',
        action: 'CREATE',
        actorId: 'admin-7',
      }),
    );
    expect(redis.del).toHaveBeenCalledWith('storefront-menu:v1:main-menu');
  });
});

describe('StorefrontMenuService.deleteMenu (Phase 48)', () => {
  it('soft-deletes (deletedAt stamped, isActive=false), does NOT hard-delete', async () => {
    const { service, storefrontMenu } = makeService();
    storefrontMenu.findUnique.mockResolvedValueOnce(baseMenu());
    storefrontMenu.update.mockResolvedValueOnce(undefined);

    await service.deleteMenu('menu-1', 'admin-7');

    expect(storefrontMenu.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'menu-1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          isActive: false,
        }),
      }),
    );
  });

  it('throws NotFound if already soft-deleted', async () => {
    const { service, storefrontMenu } = makeService();
    storefrontMenu.findUnique.mockResolvedValueOnce(baseMenu({ deletedAt: new Date() }));
    await expect(service.deleteMenu('menu-1')).rejects.toBeInstanceOf(NotFoundAppException);
  });
});

describe('StorefrontMenuService.createItem (Phase 48)', () => {
  it('refuses explicit position collision at (parentId, position)', async () => {
    const { service, storefrontMenu, storefrontMenuItem } = makeService();
    storefrontMenu.findUnique.mockResolvedValueOnce(baseMenu());
    storefrontMenuItem.findFirst.mockResolvedValueOnce({ id: 'occupier' });

    await expect(
      service.createItem('menu-1', { label: 'New', position: 3 }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('auto-defaults position to max+1 when omitted', async () => {
    const { service, storefrontMenu, storefrontMenuItem } = makeService();
    storefrontMenu.findUnique.mockResolvedValueOnce(baseMenu());
    storefrontMenuItem.aggregate.mockResolvedValueOnce({ _max: { position: 7 } });
    storefrontMenuItem.create.mockResolvedValueOnce(baseItem({ position: 8 }));

    await service.createItem('menu-1', { label: 'New' });

    expect(storefrontMenuItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ position: 8 }),
      }),
    );
  });

  it('rejects when parentId belongs to a different menu', async () => {
    const { service, storefrontMenu, storefrontMenuItem } = makeService();
    storefrontMenu.findUnique.mockResolvedValueOnce(baseMenu());
    storefrontMenuItem.findUnique.mockResolvedValueOnce(
      baseItem({ id: 'parent-1', menuId: 'OTHER_MENU' }),
    );

    await expect(
      service.createItem('menu-1', { label: 'X', parentId: 'parent-1' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });
});

describe('StorefrontMenuService.updateItem cycle + depth (Phase 48)', () => {
  it('rejects moving an item under itself', async () => {
    const { service, storefrontMenuItem } = makeService();
    storefrontMenuItem.findUnique.mockResolvedValueOnce(baseItem({ id: 'A', parentId: null }));

    await expect(
      service.updateItem('A', { parentId: 'A' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('rejects moving A under B when B is a descendant of A (cycle)', async () => {
    const { service, storefrontMenuItem } = makeService();
    // updateItem reads "before" row
    storefrontMenuItem.findUnique
      .mockResolvedValueOnce(baseItem({ id: 'A', parentId: null }))   // before
      .mockResolvedValueOnce(baseItem({ id: 'B', menuId: 'menu-1', parentId: 'A' })) // parent (B)
      // assertNoCycle walks B's ancestors: B → A → null
      .mockResolvedValueOnce({ parentId: 'A' }) // walking from B
      .mockResolvedValueOnce({ parentId: null }); // walking from A → cycle detected here because cursor === 'A' (itemId)

    await expect(
      service.updateItem('A', { parentId: 'B' }),
    ).rejects.toThrow(/cycle/i);
  });

  it('rejects when new depth would exceed MAX_MENU_DEPTH', async () => {
    const { service, storefrontMenuItem } = makeService();
    // P is nested 3 deep already (P → P2 → P3 → P4 → null).
    // computeItemDepth(P) returns 3; +1 = 4 → ≥ MAX_MENU_DEPTH (4) → reject.
    storefrontMenuItem.findUnique
      .mockResolvedValueOnce(baseItem({ id: 'A', parentId: null }))   // before
      .mockResolvedValueOnce(baseItem({ id: 'P', menuId: 'menu-1' })) // parent existence
      // assertNoCycle walks from P up; no cycle (A doesn't appear).
      .mockResolvedValueOnce({ parentId: 'P2' })
      .mockResolvedValueOnce({ parentId: 'P3' })
      .mockResolvedValueOnce({ parentId: 'P4' })
      .mockResolvedValueOnce({ parentId: null })
      // computeItemDepth walks from P: P→P2→P3→P4→null = depth 3
      .mockResolvedValueOnce({ parentId: 'P2' })
      .mockResolvedValueOnce({ parentId: 'P3' })
      .mockResolvedValueOnce({ parentId: 'P4' })
      .mockResolvedValueOnce({ parentId: null });

    await expect(
      service.updateItem('A', { parentId: 'P' }),
    ).rejects.toThrow(/maximum depth/i);
  });

  it('allows parentId change that does not cycle or exceed depth', async () => {
    const { service, storefrontMenu, storefrontMenuItem, audit } = makeService();
    storefrontMenuItem.findUnique
      .mockResolvedValueOnce(baseItem({ id: 'A', parentId: null }))
      .mockResolvedValueOnce(baseItem({ id: 'P', menuId: 'menu-1' }))
      // assertNoCycle walk
      .mockResolvedValueOnce({ parentId: null })
      // computeItemDepth walk
      .mockResolvedValueOnce({ parentId: null });
    storefrontMenuItem.update.mockResolvedValueOnce(baseItem({ id: 'A', parentId: 'P' }));
    storefrontMenu.findUnique.mockResolvedValueOnce({ handle: 'main-menu' });

    await service.updateItem('A', { parentId: 'P' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE' }),
    );
  });
});

describe('StorefrontMenuService.deleteItem (Phase 48)', () => {
  it('soft-deletes the item AND its descendants', async () => {
    const { service, storefrontMenu, storefrontMenuItem } = makeService();
    storefrontMenuItem.findUnique.mockResolvedValueOnce(baseItem({ id: 'A' }));
    // BFS collect: A → B, C; B → D; C → (none); D → (none)
    storefrontMenuItem.findMany
      .mockResolvedValueOnce([{ id: 'B' }, { id: 'C' }])
      .mockResolvedValueOnce([{ id: 'D' }])
      .mockResolvedValueOnce([]);
    storefrontMenu.findUnique.mockResolvedValueOnce({ handle: 'main-menu' });

    await service.deleteItem('A');

    expect(storefrontMenuItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['A', 'B', 'C', 'D'] } },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          isActive: false,
        }),
      }),
    );
  });
});

describe('StorefrontMenuService.getPublicMenuByHandle (Phase 48)', () => {
  it('returns the reduced shape (no linkType / linkRef / position)', async () => {
    const { service, storefrontMenu } = makeService();
    storefrontMenu.findUnique.mockResolvedValueOnce({
      ...baseMenu(),
      items: [
        baseItem({ id: 'A', label: 'Sports', linkType: MenuLinkType.URL, linkRef: '/sports' }),
      ],
    });

    const tree = await service.getPublicMenuByHandle('main-menu');
    const node = tree.items[0] as any;

    expect(node.label).toBe('Sports');
    expect(node.href).toBe('/sports');
    expect(node.linkType).toBeUndefined();
    expect(node.linkRef).toBeUndefined();
    expect(node.position).toBeUndefined();
  });

  it('filters out isActive=false items from the public tree', async () => {
    const { service, storefrontMenu } = makeService();
    storefrontMenu.findUnique.mockResolvedValueOnce({
      ...baseMenu(),
      items: [
        baseItem({ id: 'A', label: 'Active', isActive: true, position: 0 }),
        baseItem({ id: 'B', label: 'Hidden', isActive: false, position: 1 }),
      ],
    });

    const tree = await service.getPublicMenuByHandle('main-menu');
    expect(tree.items).toHaveLength(1);
    expect(tree.items[0]!.label).toBe('Active');
  });

  it('throws NotFound when menu is soft-deleted', async () => {
    const { service, storefrontMenu } = makeService();
    storefrontMenu.findUnique.mockResolvedValueOnce({
      ...baseMenu({ deletedAt: new Date() }),
      items: [],
    });
    await expect(service.getPublicMenuByHandle('main-menu')).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('throws NotFound when menu isActive=false', async () => {
    const { service, storefrontMenu } = makeService();
    storefrontMenu.findUnique.mockResolvedValueOnce({
      ...baseMenu({ isActive: false }),
      items: [],
    });
    await expect(service.getPublicMenuByHandle('main-menu')).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('uses the Redis cache (getOrSet with handle-keyed cache)', async () => {
    const { service, storefrontMenu, redis } = makeService();
    storefrontMenu.findUnique.mockResolvedValueOnce({ ...baseMenu(), items: [] });

    await service.getPublicMenuByHandle('main-menu');

    expect(redis.getOrSet).toHaveBeenCalledWith(
      'storefront-menu:v1:main-menu',
      60,
      expect.any(Function),
    );
  });

  it('uses displayLabel when present, falling back to label', async () => {
    const { service, storefrontMenu } = makeService();
    storefrontMenu.findUnique.mockResolvedValueOnce({
      ...baseMenu(),
      items: [
        baseItem({ id: 'A', label: 'cricket-bats', displayLabel: 'Cricket Bats' }),
      ],
    });

    const tree = await service.getPublicMenuByHandle('main-menu');
    expect(tree.items[0]!.label).toBe('Cricket Bats');
  });

  it('rejects javascript:/data: hrefs at render time (defence-in-depth)', async () => {
    const { service, storefrontMenu } = makeService();
    storefrontMenu.findUnique.mockResolvedValueOnce({
      ...baseMenu(),
      items: [
        baseItem({ id: 'A', linkType: MenuLinkType.URL, linkRef: 'javascript:alert(1)' }),
        baseItem({ id: 'B', linkType: MenuLinkType.URL, linkRef: '//evil.com', position: 1 }),
      ],
    });

    const tree = await service.getPublicMenuByHandle('main-menu');
    expect(tree.items[0]!.href).toBeNull();
    expect(tree.items[1]!.href).toBeNull();
  });
});

describe('StorefrontMenuService.invalidateMenuCacheByHandle (Phase 48)', () => {
  it('swallows Redis errors (best-effort)', async () => {
    const { service, redis } = makeService();
    redis.del.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.invalidateMenuCacheByHandle('main-menu')).resolves.toBeUndefined();
  });
});
