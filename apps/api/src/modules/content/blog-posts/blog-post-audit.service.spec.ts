/**
 * Phase 50 — BlogPostAuditService contract.
 */

import { BlogPostAuditService } from './blog-post-audit.service';

function makeService() {
  const create = jest.fn().mockResolvedValue(undefined);
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = { blogPostAuditLog: { create, findMany } } as any;
  return { service: new BlogPostAuditService(prisma), create, findMany };
}

describe('BlogPostAuditService.record (Phase 50)', () => {
  it('writes a row with supplied fields', async () => {
    const { service, create } = makeService();
    await service.record({
      postId: 'post-1',
      action: 'PUBLISH',
      newState: { title: 'Hello' },
      actorId: 'admin-7',
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        postId: 'post-1',
        action: 'PUBLISH',
        newState: { title: 'Hello' },
        actorId: 'admin-7',
      }),
    });
  });

  it('coerces missing actorId to null', async () => {
    const { service, create } = makeService();
    await service.record({ postId: 'post-1', action: 'CREATE' });
    expect(create.mock.calls[0][0].data.actorId).toBeNull();
  });

  it('swallows DB failures (best-effort)', async () => {
    const { service, create } = makeService();
    create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.record({ postId: 'post-1', action: 'UPDATE' }),
    ).resolves.toBeUndefined();
  });
});

describe('BlogPostAuditService.list (Phase 50)', () => {
  it('defaults to limit=50 offset=0 orderBy desc', async () => {
    const { service, findMany } = makeService();
    await service.list('post-1');
    expect(findMany).toHaveBeenCalledWith({
      where: { postId: 'post-1' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      skip: 0,
    });
  });

  it('clamps limit to 200 max', async () => {
    const { service, findMany } = makeService();
    await service.list('x', { limit: 9999 });
    expect(findMany.mock.calls[0][0].take).toBe(200);
  });
});
