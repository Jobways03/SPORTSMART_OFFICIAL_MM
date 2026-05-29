/**
 * Phase 50 (2026-05-21) — pins the security-relevant behaviour of
 * the blog service:
 *   - contentHtml is sanitized (XSS stripped) on create + update
 *   - imagePublicId persisted on upload
 *   - prior Cloudinary asset deleted on replace
 *   - orphan cleanup on DB failure after upload
 *   - soft-delete fires Cloudinary cleanup
 *   - tags normalized: lowercase + trim + dedupe + cap 20
 *   - category restricted to allowlist; unknown → 400
 *   - P2002 on create → ConflictAppException
 *   - audit log written for every transition
 *   - public cache invalidated on every admin write
 */

import { BlogPostStatus } from '@prisma/client';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../core/exceptions';
import { BlogPostsService } from './blog-posts.service';

function baseRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'post-1',
    slug: 'hello',
    title: 'Hello',
    excerpt: null,
    contentHtml: '<p>Hello</p>',
    imageUrl: null,
    imagePublicId: null,
    imageAlt: null,
    author: null,
    category: 'News',
    tags: [],
    status: BlogPostStatus.HIDDEN,
    publishedAt: null,
    metaTitle: null,
    metaDesc: null,
    canonicalUrl: null,
    ogImage: null,
    noIndex: false,
    deletedAt: null,
    createdById: null,
    updatedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeService() {
  const blogPost = {
    findUnique: jest.fn(),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const prisma: any = { blogPost };

  const cloudinary = {
    upload: jest.fn().mockResolvedValue({
      secureUrl: 'https://res.cloudinary.com/x/new.jpg',
      publicId: 'blog-posts/hello/new-pid',
    }),
    delete: jest.fn().mockResolvedValue(undefined),
  } as any;

  const audit = { record: jest.fn().mockResolvedValue(undefined), list: jest.fn() } as any;

  const redis = {
    del: jest.fn().mockResolvedValue(undefined),
    delPattern: jest.fn().mockResolvedValue(undefined),
    getOrSet: jest.fn(async (_k: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
  } as any;

  const service = new BlogPostsService(prisma, cloudinary, audit, redis);
  return { service, prisma, blogPost, cloudinary, audit, redis };
}

describe('BlogPostsService.create (Phase 50)', () => {
  it('sanitizes contentHtml (strips <script>)', async () => {
    const { service, blogPost } = makeService();
    blogPost.create.mockImplementationOnce(async ({ data }: any) =>
      baseRow({ contentHtml: data.contentHtml }),
    );

    await service.create({
      title: 'Post',
      contentHtml: '<p>Safe</p><script>alert(1)</script>',
    });

    const persisted = blogPost.create.mock.calls[0][0].data.contentHtml;
    expect(persisted).not.toContain('<script');
    expect(persisted).not.toContain('alert');
  });

  it('strips inline event handlers', async () => {
    const { service, blogPost } = makeService();
    blogPost.create.mockImplementationOnce(async ({ data }: any) =>
      baseRow({ contentHtml: data.contentHtml }),
    );

    await service.create({
      title: 'Post',
      contentHtml: '<p onclick="alert(1)">Hi</p>',
    });

    const persisted = blogPost.create.mock.calls[0][0].data.contentHtml;
    expect(persisted).not.toContain('onclick');
  });

  it('catches Prisma P2002 → ConflictAppException', async () => {
    const { service, blogPost } = makeService();
    const p2002 = Object.assign(new Error('unique'), { code: 'P2002' });
    blogPost.create.mockRejectedValueOnce(p2002);

    await expect(service.create({ title: 'Hello' })).rejects.toBeInstanceOf(
      ConflictAppException,
    );
  });

  it('normalizes tags (lowercase, trim, dedupe, cap 20)', async () => {
    const { service, blogPost } = makeService();
    blogPost.create.mockImplementationOnce(async ({ data }: any) =>
      baseRow({ tags: data.tags }),
    );

    await service.create({
      title: 'Post',
      tags: ['Cricket', 'CRICKET', '  cricket  ', 'Football'],
    });

    const persisted = blogPost.create.mock.calls[0][0].data.tags;
    expect(persisted).toEqual(['cricket', 'football']);
  });

  it('caps tags at 20', async () => {
    const { service, blogPost } = makeService();
    blogPost.create.mockImplementationOnce(async ({ data }: any) =>
      baseRow({ tags: data.tags }),
    );

    const manyTags = Array.from({ length: 30 }, (_, i) => `tag-${i}`);
    await service.create({ title: 'Post', tags: manyTags });

    expect(blogPost.create.mock.calls[0][0].data.tags).toHaveLength(20);
  });

  it('rejects an unknown category', async () => {
    const { service } = makeService();
    await expect(
      service.create({ title: 'Post', category: 'HACKED' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('case-normalizes a known category', async () => {
    const { service, blogPost } = makeService();
    blogPost.create.mockImplementationOnce(async ({ data }: any) =>
      baseRow({ category: data.category }),
    );

    await service.create({ title: 'Post', category: 'sports' });

    expect(blogPost.create.mock.calls[0][0].data.category).toBe('Sports');
  });

  it('stamps publishedAt when status=VISIBLE on create', async () => {
    const { service, blogPost } = makeService();
    blogPost.create.mockImplementationOnce(async ({ data }: any) =>
      baseRow({ status: data.status, publishedAt: data.publishedAt }),
    );

    await service.create({ title: 'Post', status: BlogPostStatus.VISIBLE });

    expect(blogPost.create.mock.calls[0][0].data.publishedAt).toBeInstanceOf(Date);
  });

  it('writes a CREATE audit row + invalidates cache', async () => {
    const { service, blogPost, audit, redis } = makeService();
    blogPost.create.mockResolvedValueOnce(baseRow());

    await service.create({ title: 'Hello' }, 'admin-7');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', actorId: 'admin-7' }),
    );
    // create slugifies the title — title 'Hello' → slug 'hello'
    expect(redis.del).toHaveBeenCalledWith('blog-posts:v1:slug:hello');
    expect(redis.delPattern).toHaveBeenCalledWith('blog-posts:v1:list:*');
  });
});

describe('BlogPostsService.update (Phase 50)', () => {
  it('sanitizes contentHtml on update', async () => {
    const { service, blogPost } = makeService();
    blogPost.findUnique.mockResolvedValueOnce(baseRow());
    blogPost.update.mockImplementationOnce(async ({ data }: any) =>
      baseRow({ contentHtml: data.contentHtml }),
    );

    await service.update('post-1', {
      contentHtml: '<p>Safe</p><script>alert(1)</script>',
    });

    const persisted = blogPost.update.mock.calls[0][0].data.contentHtml;
    expect(persisted).not.toContain('<script');
  });

  it('refuses to update a soft-deleted post', async () => {
    const { service, blogPost } = makeService();
    blogPost.findUnique.mockResolvedValueOnce(baseRow({ deletedAt: new Date() }));

    await expect(
      service.update('post-1', { title: 'New' }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('writes a PUBLISH audit action when status flips HIDDEN→VISIBLE', async () => {
    const { service, blogPost, audit } = makeService();
    blogPost.findUnique.mockResolvedValueOnce(
      baseRow({ status: BlogPostStatus.HIDDEN, publishedAt: null }),
    );
    blogPost.update.mockImplementationOnce(async ({ data }: any) =>
      baseRow({ status: data.status, publishedAt: data.publishedAt }),
    );

    await service.update('post-1', { status: BlogPostStatus.VISIBLE });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PUBLISH' }),
    );
  });

  it('stamps publishedAt only the first time', async () => {
    const earlier = new Date('2025-12-01T00:00:00Z');
    const { service, blogPost } = makeService();
    blogPost.findUnique.mockResolvedValueOnce(
      baseRow({
        status: BlogPostStatus.HIDDEN,
        publishedAt: earlier,
      }),
    );
    blogPost.update.mockImplementationOnce(async ({ data }: any) =>
      baseRow({ status: data.status, publishedAt: data.publishedAt }),
    );

    await service.update('post-1', { status: BlogPostStatus.VISIBLE });

    // publishedAt is NOT in the data because before.publishedAt was set
    expect(blogPost.update.mock.calls[0][0].data.publishedAt).toBeUndefined();
  });
});

describe('BlogPostsService.uploadImage (Phase 50)', () => {
  it('persists imagePublicId returned by Cloudinary', async () => {
    const { service, blogPost } = makeService();
    blogPost.findUnique.mockResolvedValueOnce(baseRow());
    blogPost.update.mockImplementationOnce(async ({ data }: any) =>
      baseRow({ imageUrl: data.imageUrl, imagePublicId: data.imagePublicId }),
    );

    await service.uploadImage('post-1', {
      buffer: Buffer.from('jpg'),
      mimetype: 'image/jpeg',
      originalname: 'h.jpg',
    });

    expect(blogPost.update.mock.calls[0][0].data.imagePublicId).toBe(
      'blog-posts/hello/new-pid',
    );
  });

  it('deletes the prior asset when replacing (different publicId)', async () => {
    const { service, blogPost, cloudinary } = makeService();
    blogPost.findUnique.mockResolvedValueOnce(
      baseRow({ imagePublicId: 'blog-posts/hello/OLD' }),
    );
    blogPost.update.mockResolvedValueOnce(
      baseRow({ imagePublicId: 'blog-posts/hello/new-pid' }),
    );

    await service.uploadImage('post-1', {
      buffer: Buffer.from('jpg'),
      mimetype: 'image/jpeg',
      originalname: 'h.jpg',
    });

    expect(cloudinary.delete).toHaveBeenCalledWith('blog-posts/hello/OLD');
    await new Promise((r) => setImmediate(r));
  });

  it('cleans up freshly-uploaded asset if DB write fails', async () => {
    const { service, blogPost, cloudinary } = makeService();
    blogPost.findUnique.mockResolvedValueOnce(baseRow());
    blogPost.update.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.uploadImage('post-1', {
        buffer: Buffer.from('jpg'),
        mimetype: 'image/jpeg',
        originalname: 'h.jpg',
      }),
    ).rejects.toThrow('db down');

    expect(cloudinary.delete).toHaveBeenCalledWith('blog-posts/hello/new-pid');
    await new Promise((r) => setImmediate(r));
  });
});

describe('BlogPostsService.delete (Phase 50)', () => {
  it('soft-deletes via deletedAt + ARCHIVED status (no hard delete)', async () => {
    const { service, blogPost } = makeService();
    blogPost.findUnique.mockResolvedValueOnce(baseRow());
    blogPost.update.mockResolvedValueOnce(undefined);

    await service.delete('post-1', 'admin-7');

    expect(blogPost.delete).not.toHaveBeenCalled();
    const data = blogPost.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.status).toBe(BlogPostStatus.ARCHIVED);
  });

  it('fires Cloudinary delete if a publicId was set', async () => {
    const { service, blogPost, cloudinary } = makeService();
    blogPost.findUnique.mockResolvedValueOnce(
      baseRow({ imagePublicId: 'blog-posts/hello/pid' }),
    );
    blogPost.update.mockResolvedValueOnce(undefined);

    await service.delete('post-1');

    expect(cloudinary.delete).toHaveBeenCalledWith('blog-posts/hello/pid');
    await new Promise((r) => setImmediate(r));
  });

  it('is idempotent on an already-soft-deleted post', async () => {
    const { service, blogPost } = makeService();
    blogPost.findUnique.mockResolvedValueOnce(baseRow({ deletedAt: new Date() }));

    await expect(service.delete('post-1')).resolves.toBeUndefined();
    expect(blogPost.update).not.toHaveBeenCalled();
  });
});

describe('BlogPostsService.restore (Phase 50)', () => {
  it('reverses a soft-delete', async () => {
    const { service, blogPost } = makeService();
    blogPost.findUnique.mockResolvedValueOnce(baseRow({ deletedAt: new Date() }));
    blogPost.update.mockResolvedValueOnce(baseRow());

    await service.restore('post-1');

    const data = blogPost.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeNull();
    expect(data.status).toBe(BlogPostStatus.HIDDEN);
  });

  it('refuses to restore a not-deleted post', async () => {
    const { service, blogPost } = makeService();
    blogPost.findUnique.mockResolvedValueOnce(baseRow());

    await expect(service.restore('post-1')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });
});

describe('BlogPostsService.publicList + publicGetBySlug (Phase 50)', () => {
  it('uses Redis cache for the list', async () => {
    const { service, redis, blogPost } = makeService();
    blogPost.findMany.mockResolvedValueOnce([]);
    blogPost.count.mockResolvedValueOnce(0);

    await service.publicList({ page: 1, limit: 10 });

    expect(redis.getOrSet).toHaveBeenCalledWith(
      'blog-posts:v1:list:p1:l10',
      60,
      expect.any(Function),
    );
  });

  it('uses Redis cache for the slug get', async () => {
    const { service, redis, blogPost } = makeService();
    blogPost.findFirst.mockResolvedValueOnce(baseRow({ status: BlogPostStatus.VISIBLE }));

    await service.publicGetBySlug('hello');

    expect(redis.getOrSet).toHaveBeenCalledWith(
      'blog-posts:v1:slug:hello',
      60,
      expect.any(Function),
    );
  });

  it('filters status=VISIBLE AND deletedAt=null in the underlying query', async () => {
    const { service, blogPost } = makeService();
    blogPost.findMany.mockResolvedValueOnce([]);
    blogPost.count.mockResolvedValueOnce(0);

    await service.publicList({ page: 1, limit: 10 });

    expect(blogPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: BlogPostStatus.VISIBLE, deletedAt: null },
      }),
    );
  });

  it('returns 404 for hidden posts via the slug get', async () => {
    const { service, blogPost } = makeService();
    blogPost.findFirst.mockResolvedValueOnce(null);

    await expect(service.publicGetBySlug('hidden')).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });
});

describe('BlogPostsService.invalidatePublicCache (Phase 50)', () => {
  it('swallows Redis outages (best-effort)', async () => {
    const { service, redis } = makeService();
    redis.del.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.invalidatePublicCache('hello')).resolves.toBeUndefined();
  });
});
