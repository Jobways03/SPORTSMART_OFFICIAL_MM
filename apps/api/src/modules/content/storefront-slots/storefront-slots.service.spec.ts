/**
 * Phase 47 (2026-05-21) — pins the slot-service security contract:
 *   - race-safe create catches Prisma P2002 → ConflictAppException
 *   - isSystem=true delete throws ForbiddenAppException
 *   - remove() soft-deletes the cascade content block (no hard delete)
 *   - audit row written on every transition
 *   - cache invalidated on delete (because the cascade affects the
 *     public listActiveAsMap)
 */

import {
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../core/exceptions';
import { StorefrontSlotsService } from './storefront-slots.service';

function makeService() {
  const slotDef = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
  };
  const contentBlock = {
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  };

  // $transaction(fn) — pass the same mock through so inner code uses
  // the same stub.
  const prisma: any = {
    storefrontSlotDefinition: slotDef,
    storefrontContentBlock: contentBlock,
    $transaction: jest.fn(async (fn: any) => fn({ storefrontSlotDefinition: slotDef, storefrontContentBlock: contentBlock })),
  };

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const content = { invalidateActiveMapCache: jest.fn().mockResolvedValue(undefined) } as any;

  const service = new StorefrontSlotsService(prisma, audit, content);
  return { service, prisma, slotDef, contentBlock, audit, content };
}

describe('StorefrontSlotsService.create (Phase 47)', () => {
  it('rejects an unknown sectionKey', async () => {
    const { service } = makeService();
    await expect(
      service.create({ sectionKey: 'mystery', label: 'X' } as any),
    ).rejects.toThrow(/Unknown section/);
  });

  it('rejects an empty label', async () => {
    const { service } = makeService();
    await expect(
      service.create({ sectionKey: 'hero', label: '   ' }),
    ).rejects.toThrow(/label is required/);
  });

  it('catches Prisma P2002 → ConflictAppException (race-safe create)', async () => {
    const { service, slotDef } = makeService();
    slotDef.findFirst.mockResolvedValue(null); // no existing
    const p2002 = Object.assign(new Error('unique violation'), { code: 'P2002' });
    slotDef.create.mockRejectedValueOnce(p2002);

    await expect(
      service.create({ sectionKey: 'hero', label: 'Hero Slide 5' }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('rethrows non-P2002 errors unchanged', async () => {
    const { service, slotDef } = makeService();
    slotDef.findFirst.mockResolvedValue(null);
    slotDef.create.mockRejectedValueOnce(new Error('db connection lost'));

    await expect(
      service.create({ sectionKey: 'hero', label: 'Hero Slide 5' }),
    ).rejects.toThrow('db connection lost');
  });

  it('writes a CREATE audit row on success', async () => {
    const { service, slotDef, audit } = makeService();
    slotDef.findFirst.mockResolvedValue(null);
    slotDef.create.mockResolvedValueOnce({
      id: 'def-1',
      sectionKey: 'hero',
      slotKey: 'hero-slide-hero-slide-5',
      label: 'Hero Slide 5',
      position: 1,
      defaultHref: null,
      isSystem: false,
    });

    await service.create({ sectionKey: 'hero', label: 'Hero Slide 5' }, 'admin-7');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'SLOT',
        resourceId: 'def-1',
        action: 'CREATE',
        actorId: 'admin-7',
      }),
    );
  });
});

describe('StorefrontSlotsService.remove (Phase 47)', () => {
  it('throws NotFound when the def is missing', async () => {
    const { service, slotDef } = makeService();
    slotDef.findUnique.mockResolvedValueOnce(null);
    await expect(service.remove('def-1')).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('throws NotFound when the def is already soft-deleted', async () => {
    const { service, slotDef } = makeService();
    slotDef.findUnique.mockResolvedValueOnce({
      id: 'def-1',
      isSystem: false,
      deletedAt: new Date(),
      sectionKey: 'hero',
      slotKey: 'hero-slide-1',
      label: 'L',
      position: 1,
    });
    await expect(service.remove('def-1')).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('refuses to delete isSystem=true with ForbiddenAppException', async () => {
    const { service, slotDef } = makeService();
    slotDef.findUnique.mockResolvedValueOnce({
      id: 'def-1',
      isSystem: true,
      deletedAt: null,
      sectionKey: 'hero',
      slotKey: 'hero-slide-1',
      label: 'L',
      position: 1,
    });
    await expect(service.remove('def-1')).rejects.toBeInstanceOf(ForbiddenAppException);
  });

  it('soft-deletes the cascade content block (updateMany, NOT delete)', async () => {
    const { service, slotDef, contentBlock } = makeService();
    slotDef.findUnique.mockResolvedValueOnce({
      id: 'def-1',
      isSystem: false,
      deletedAt: null,
      sectionKey: 'hero',
      slotKey: 'hero-slide-1',
      label: 'L',
      position: 1,
    });
    slotDef.update.mockResolvedValueOnce(undefined);
    contentBlock.updateMany.mockResolvedValueOnce({ count: 1 });

    await service.remove('def-1');

    expect(contentBlock.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slot: 'hero-slide-1', deletedAt: null },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          active: false,
        }),
      }),
    );
    expect(slotDef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'def-1' },
        data: { deletedAt: expect.any(Date) },
      }),
    );
  });

  it('writes a DELETE audit row + invalidates the public-content cache', async () => {
    const { service, slotDef, audit, content } = makeService();
    slotDef.findUnique.mockResolvedValueOnce({
      id: 'def-1',
      isSystem: false,
      deletedAt: null,
      sectionKey: 'hero',
      slotKey: 'hero-slide-1',
      label: 'L',
      position: 1,
    });
    slotDef.update.mockResolvedValueOnce(undefined);

    await service.remove('def-1', 'admin-7');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'SLOT',
        resourceId: 'def-1',
        action: 'DELETE',
        actorId: 'admin-7',
      }),
    );
    expect(content.invalidateActiveMapCache).toHaveBeenCalledTimes(1);
  });
});

describe('StorefrontSlotsService.list (Phase 47)', () => {
  it('excludes soft-deleted slots from the admin list', async () => {
    const { service, slotDef } = makeService();
    slotDef.findMany.mockResolvedValueOnce([]);

    await service.list();

    expect(slotDef.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null },
      }),
    );
  });
});
