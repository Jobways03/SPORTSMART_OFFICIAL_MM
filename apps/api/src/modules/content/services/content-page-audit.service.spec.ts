/**
 * Phase 49 (2026-05-21) — ContentPageAuditService contract. Best-
 * effort: a DB outage must NOT propagate to the mutation path.
 */

import { ContentPageAuditService } from './content-page-audit.service';

function makeService() {
  const create = jest.fn().mockResolvedValue(undefined);
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = { contentPageAuditLog: { create, findMany } } as any;
  return { service: new ContentPageAuditService(prisma), create, findMany };
}

describe('ContentPageAuditService.record', () => {
  it('writes a row with supplied fields', async () => {
    const { service, create } = makeService();
    await service.record({
      resourceType: 'PAGE',
      resourceId: 'refund-policy',
      action: 'PUBLISH',
      prevTitle: 'Old',
      newTitle: 'New',
      actorId: 'admin-7',
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resourceType: 'PAGE',
        resourceId: 'refund-policy',
        action: 'PUBLISH',
        prevTitle: 'Old',
        newTitle: 'New',
        actorId: 'admin-7',
      }),
    });
  });

  it('coerces missing fields to null', async () => {
    const { service, create } = makeService();
    await service.record({
      resourceType: 'FAQ',
      resourceId: 'faq-1',
      action: 'CREATE',
    });
    const data = create.mock.calls[0][0].data;
    expect(data.actorId).toBeNull();
    expect(data.prevTitle).toBeNull();
    expect(data.newBody).toBeNull();
  });

  it('swallows DB failures', async () => {
    const { service, create } = makeService();
    create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.record({
        resourceType: 'PAGE',
        resourceId: 'x',
        action: 'DELETE',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('ContentPageAuditService.list', () => {
  it('defaults limit=50 offset=0', async () => {
    const { service, findMany } = makeService();
    await service.list('PAGE', 'refund-policy');
    expect(findMany).toHaveBeenCalledWith({
      where: { resourceType: 'PAGE', resourceId: 'refund-policy' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      skip: 0,
    });
  });

  it('clamps limit to 200', async () => {
    const { service, findMany } = makeService();
    await service.list('PAGE', 'x', { limit: 99999 });
    expect(findMany.mock.calls[0][0].take).toBe(200);
  });

  it('floors offset to 0', async () => {
    const { service, findMany } = makeService();
    await service.list('PAGE', 'x', { offset: -5 });
    expect(findMany.mock.calls[0][0].skip).toBe(0);
  });
});
