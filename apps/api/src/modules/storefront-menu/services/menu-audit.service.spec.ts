/**
 * Phase 48 (2026-05-21) — MenuAuditService contract. Best-effort:
 * a DB outage must NOT throw, because the audit log is a mirror,
 * not the source of truth.
 */

import { MenuAuditService } from './menu-audit.service';

function makeService() {
  const create = jest.fn().mockResolvedValue(undefined);
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = { menuAuditLog: { create, findMany } } as any;
  return { service: new MenuAuditService(prisma), create, findMany };
}

describe('MenuAuditService.record (Phase 48)', () => {
  it('writes a row with supplied fields', async () => {
    const { service, create } = makeService();
    await service.record({
      resourceType: 'MENU',
      resourceId: 'menu-1',
      action: 'CREATE',
      newState: { handle: 'main-menu' },
      actorId: 'admin-7',
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resourceType: 'MENU',
        resourceId: 'menu-1',
        action: 'CREATE',
        newState: { handle: 'main-menu' },
        actorId: 'admin-7',
      }),
    });
  });

  it('coerces missing actorId to null', async () => {
    const { service, create } = makeService();
    await service.record({
      resourceType: 'MENU_ITEM',
      resourceId: 'item-1',
      action: 'DELETE',
    });
    expect(create.mock.calls[0][0].data.actorId).toBeNull();
  });

  it('swallows DB failures (best-effort)', async () => {
    const { service, create } = makeService();
    create.mockRejectedValueOnce(new Error('boom'));
    await expect(
      service.record({
        resourceType: 'MENU',
        resourceId: 'menu-1',
        action: 'UPDATE',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('MenuAuditService.list (Phase 48)', () => {
  it('defaults to limit=50 offset=0 orderBy desc', async () => {
    const { service, findMany } = makeService();
    await service.list('MENU', 'menu-1');
    expect(findMany).toHaveBeenCalledWith({
      where: { resourceType: 'MENU', resourceId: 'menu-1' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      skip: 0,
    });
  });

  it('clamps limit to 200', async () => {
    const { service, findMany } = makeService();
    await service.list('MENU', 'x', { limit: 9999 });
    expect(findMany.mock.calls[0][0].take).toBe(200);
  });

  it('floors limit to 1', async () => {
    const { service, findMany } = makeService();
    await service.list('MENU', 'x', { limit: 0 });
    expect(findMany.mock.calls[0][0].take).toBe(1);
  });

  it('clamps offset to >= 0', async () => {
    const { service, findMany } = makeService();
    await service.list('MENU_ITEM', 'x', { offset: -10 });
    expect(findMany.mock.calls[0][0].skip).toBe(0);
  });
});
