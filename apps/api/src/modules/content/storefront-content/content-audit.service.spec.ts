/**
 * Phase 47 (2026-05-21) — ContentAuditService is best-effort: a DB
 * failure here must NOT throw, because the audit log is a mirror, not
 * the source of truth. These tests pin that contract + the list()
 * pagination bounds.
 */

import { ContentAuditService } from './content-audit.service';

function makeService() {
  const create = jest.fn().mockResolvedValue(undefined);
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = { contentAuditLog: { create, findMany } } as any;
  return { service: new ContentAuditService(prisma), create, findMany };
}

describe('ContentAuditService.record (Phase 47)', () => {
  it('writes a row with the supplied fields', async () => {
    const { service, create } = makeService();
    await service.record({
      resourceType: 'CONTENT_BLOCK',
      resourceId: 'hero-slide-1',
      action: 'UPDATE',
      prevState: { headline: 'old' },
      newState: { headline: 'new' },
      actorId: 'admin-7',
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resourceType: 'CONTENT_BLOCK',
        resourceId: 'hero-slide-1',
        action: 'UPDATE',
        prevState: { headline: 'old' },
        newState: { headline: 'new' },
        actorId: 'admin-7',
      }),
    });
  });

  it('coerces a null actorId to null (not undefined)', async () => {
    const { service, create } = makeService();
    await service.record({
      resourceType: 'SLOT',
      resourceId: 'slot-id-1',
      action: 'CREATE',
      newState: { slotKey: 's' },
    });
    expect(create.mock.calls[0][0].data.actorId).toBeNull();
  });

  it('swallows DB failures (best-effort)', async () => {
    const { service, create } = makeService();
    create.mockRejectedValueOnce(new Error('boom'));
    await expect(
      service.record({
        resourceType: 'SLOT',
        resourceId: 'x',
        action: 'DELETE',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('ContentAuditService.list (Phase 47)', () => {
  it('defaults to limit=50 offset=0', async () => {
    const { service, findMany } = makeService();
    await service.list('CONTENT_BLOCK', 'hero-slide-1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { resourceType: 'CONTENT_BLOCK', resourceId: 'hero-slide-1' },
        take: 50,
        skip: 0,
      }),
    );
  });

  it('clamps limit to 200 max', async () => {
    const { service, findMany } = makeService();
    await service.list('CONTENT_BLOCK', 'x', { limit: 1000 });
    expect(findMany.mock.calls[0][0].take).toBe(200);
  });

  it('floors limit to 1 min', async () => {
    const { service, findMany } = makeService();
    await service.list('CONTENT_BLOCK', 'x', { limit: 0 });
    expect(findMany.mock.calls[0][0].take).toBe(1);
  });

  it('clamps offset to >= 0', async () => {
    const { service, findMany } = makeService();
    await service.list('CONTENT_BLOCK', 'x', { offset: -5 });
    expect(findMany.mock.calls[0][0].skip).toBe(0);
  });

  it('orders by createdAt desc', async () => {
    const { service, findMany } = makeService();
    await service.list('SLOT', 'x');
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
  });
});
