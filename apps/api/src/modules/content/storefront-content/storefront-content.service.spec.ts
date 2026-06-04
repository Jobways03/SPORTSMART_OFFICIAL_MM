/**
 * Phase 47 (2026-05-21) — pins the media cleanup contract on the
 * write paths (resetSlot / uploadImage) and the cache invalidation
 * behaviour. Pre-Phase-47 the service hard-deleted the row, did not
 * persist publicId, and never invalidated. Each of those would have
 * caused a real bug:
 *   - storage leak (orphan media asset on replace/reset)
 *   - "the banner I uploaded isn't showing" (stale Redis cache)
 *   - "the old image still shows on the homepage" (no soft-delete
 *      visibility on the public read).
 */

import { StorefrontContentService } from './storefront-content.service';

function makeService() {
  const cloudinary = {
    upload: jest.fn().mockResolvedValue({
      secureUrl: 'https://res.cloudinary.com/x/image/upload/v1/new.jpg',
      publicId: 'storefront-content/hero-slide-1/abc123',
    }),
    delete: jest.fn().mockResolvedValue(undefined),
  };

  const prismaContentBlock = {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const prisma: any = { storefrontContentBlock: prismaContentBlock };

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;

  // Default: getOrSet just calls the factory through (no-cache path).
  const redis = {
    del: jest.fn().mockResolvedValue(undefined),
    getOrSet: jest.fn(async (_k: string, _ttl: number, factory: () => Promise<unknown>) => factory()),
  } as any;

  const service = new StorefrontContentService(prisma, cloudinary as any, audit, redis);
  return { service, prisma: prismaContentBlock, cloudinary, audit, redis };
}

function makeRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    slot: 'hero-slide-1',
    imageUrl: null,
    imagePublicId: null,
    imageAlt: null,
    eyebrow: null,
    headline: null,
    subhead: null,
    ctaLabel: null,
    ctaHref: null,
    price: null,
    priceCaption: null,
    active: true,
    startAt: null,
    endAt: null,
    deletedAt: null,
    updatedAt: new Date(),
    ...over,
  };
}

describe('StorefrontContentService.uploadImage (Phase 47)', () => {
  it('persists imagePublicId returned by media', async () => {
    const { service, prisma, cloudinary } = makeService();
    prisma.findUnique.mockResolvedValueOnce(null); // no prior
    prisma.upsert.mockResolvedValueOnce(
      makeRow({
        imageUrl: 'https://res.cloudinary.com/x/image/upload/v1/new.jpg',
        imagePublicId: 'storefront-content/hero-slide-1/abc123',
      }),
    );

    await service.uploadImage('hero-slide-1', {
      buffer: Buffer.from('jpg'),
      mimetype: 'image/jpeg',
      originalname: 'h.jpg',
    });

    expect(cloudinary.upload).toHaveBeenCalledTimes(1);
    expect(prisma.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          imagePublicId: 'storefront-content/hero-slide-1/abc123',
        }),
        update: expect.objectContaining({
          imagePublicId: 'storefront-content/hero-slide-1/abc123',
        }),
      }),
    );
  });

  it('deletes the PRIOR asset when replacing (different publicId)', async () => {
    const { service, prisma, cloudinary } = makeService();
    prisma.findUnique.mockResolvedValueOnce(
      makeRow({ imagePublicId: 'storefront-content/hero-slide-1/OLD' }),
    );
    prisma.upsert.mockResolvedValueOnce(
      makeRow({ imagePublicId: 'storefront-content/hero-slide-1/abc123' }),
    );

    await service.uploadImage('hero-slide-1', {
      buffer: Buffer.from('jpg'),
      mimetype: 'image/jpeg',
      originalname: 'h.jpg',
    });

    // The replacement asset must be the OLD publicId (fire-and-forget)
    expect(cloudinary.delete).toHaveBeenCalledWith('storefront-content/hero-slide-1/OLD');
    // Fire-and-forget: settle so jest doesn't warn about open handles.
    await new Promise((r) => setImmediate(r));
  });

  it('does NOT delete the prior asset when publicId is unchanged (defensive)', async () => {
    const { service, prisma, cloudinary } = makeService();
    // media returns the same publicId as before (rare but possible).
    cloudinary.upload.mockResolvedValueOnce({
      secureUrl: 'https://res.cloudinary.com/x/image/upload/v1/same.jpg',
      publicId: 'storefront-content/hero-slide-1/same',
    });
    prisma.findUnique.mockResolvedValueOnce(
      makeRow({ imagePublicId: 'storefront-content/hero-slide-1/same' }),
    );
    prisma.upsert.mockResolvedValueOnce(
      makeRow({ imagePublicId: 'storefront-content/hero-slide-1/same' }),
    );

    await service.uploadImage('hero-slide-1', {
      buffer: Buffer.from('jpg'),
      mimetype: 'image/jpeg',
      originalname: 'h.jpg',
    });

    expect(cloudinary.delete).not.toHaveBeenCalled();
  });

  it('cleans up the freshly-uploaded asset if the DB write fails (orphan prevention)', async () => {
    const { service, prisma, cloudinary } = makeService();
    prisma.findUnique.mockResolvedValueOnce(null);
    prisma.upsert.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.uploadImage('hero-slide-1', {
        buffer: Buffer.from('jpg'),
        mimetype: 'image/jpeg',
        originalname: 'h.jpg',
      }),
    ).rejects.toThrow('db down');

    // The just-uploaded media asset must be deleted.
    expect(cloudinary.delete).toHaveBeenCalledWith(
      'storefront-content/hero-slide-1/abc123',
    );
    await new Promise((r) => setImmediate(r));
  });

  it('writes an UPLOAD audit row + invalidates the cache', async () => {
    const { service, prisma, audit, redis } = makeService();
    prisma.findUnique.mockResolvedValueOnce(null);
    prisma.upsert.mockResolvedValueOnce(
      makeRow({ imagePublicId: 'storefront-content/hero-slide-1/abc123' }),
    );

    await service.uploadImage('hero-slide-1', {
      buffer: Buffer.from('jpg'),
      mimetype: 'image/jpeg',
      originalname: 'h.jpg',
    }, 'admin-7');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'CONTENT_BLOCK',
        resourceId: 'hero-slide-1',
        action: 'UPLOAD',
        actorId: 'admin-7',
      }),
    );
    expect(redis.del).toHaveBeenCalledWith('storefront-content:active-map:v1');
  });
});

describe('StorefrontContentService.resetSlot (Phase 47)', () => {
  it('soft-deletes the row + deletes media asset fire-and-forget', async () => {
    const { service, prisma, cloudinary } = makeService();
    prisma.findUnique.mockResolvedValueOnce(
      makeRow({ imagePublicId: 'storefront-content/hero-slide-1/OLD' }),
    );
    prisma.update.mockResolvedValueOnce(undefined);

    await service.resetSlot('hero-slide-1', 'admin-7');

    expect(prisma.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slot: 'hero-slide-1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          active: false,
        }),
      }),
    );
    expect(cloudinary.delete).toHaveBeenCalledWith(
      'storefront-content/hero-slide-1/OLD',
    );
    await new Promise((r) => setImmediate(r));
  });

  it('is a no-op when the row is already soft-deleted (idempotent)', async () => {
    const { service, prisma, cloudinary } = makeService();
    prisma.findUnique.mockResolvedValueOnce(
      makeRow({ deletedAt: new Date(), imagePublicId: 'x' }),
    );

    await service.resetSlot('hero-slide-1');

    expect(prisma.update).not.toHaveBeenCalled();
    expect(cloudinary.delete).not.toHaveBeenCalled();
  });

  it('does not call media delete when imagePublicId is null', async () => {
    const { service, prisma, cloudinary } = makeService();
    prisma.findUnique.mockResolvedValueOnce(makeRow({ imagePublicId: null }));
    prisma.update.mockResolvedValueOnce(undefined);

    await service.resetSlot('hero-slide-1');

    expect(cloudinary.delete).not.toHaveBeenCalled();
  });

  it('writes a RESET audit row + invalidates cache', async () => {
    const { service, prisma, audit, redis } = makeService();
    prisma.findUnique.mockResolvedValueOnce(
      makeRow({ imagePublicId: 'x', headline: 'Free shipping' }),
    );
    prisma.update.mockResolvedValueOnce(undefined);

    await service.resetSlot('hero-slide-1', 'admin-7');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'CONTENT_BLOCK',
        resourceId: 'hero-slide-1',
        action: 'RESET',
        actorId: 'admin-7',
      }),
    );
    expect(redis.del).toHaveBeenCalledWith('storefront-content:active-map:v1');
  });
});

describe('StorefrontContentService.listActiveAsMap (Phase 47)', () => {
  it('uses the Redis cache when called without an `at` override', async () => {
    const { service, redis, prisma } = makeService();
    prisma.findMany.mockResolvedValueOnce([]);

    await service.listActiveAsMap();

    expect(redis.getOrSet).toHaveBeenCalledWith(
      'storefront-content:active-map:v1',
      30,
      expect.any(Function),
    );
  });

  it('bypasses the cache when an explicit `at` is passed', async () => {
    const { service, redis, prisma } = makeService();
    prisma.findMany.mockResolvedValueOnce([]);

    await service.listActiveAsMap(new Date('2026-06-01T00:00:00.000Z'));

    expect(redis.getOrSet).not.toHaveBeenCalled();
    expect(prisma.findMany).toHaveBeenCalledTimes(1);
  });

  it('filters by active=true AND deletedAt=null AND within schedule window', async () => {
    const { service, prisma } = makeService();
    prisma.findMany.mockResolvedValueOnce([]);
    const at = new Date('2026-06-01T12:00:00.000Z');

    await service.listActiveAsMap(at);

    expect(prisma.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          deletedAt: null,
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: [{ startAt: null }, { startAt: { lte: at } }],
            }),
            expect.objectContaining({
              OR: [{ endAt: null }, { endAt: { gt: at } }],
            }),
          ]),
        }),
      }),
    );
  });
});

describe('StorefrontContentService.invalidateActiveMapCache (Phase 47)', () => {
  it('swallows Redis errors so write paths never fail on a cache outage', async () => {
    const { service, redis } = makeService();
    redis.del.mockRejectedValueOnce(new Error('redis down'));

    await expect(service.invalidateActiveMapCache()).resolves.toBeUndefined();
  });
});
