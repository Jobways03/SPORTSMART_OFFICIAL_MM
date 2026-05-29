/**
 * Phase 49 (2026-05-21) — pins the security-relevant behaviour for
 * static pages + FAQ:
 *   - getPageBySlug returns ONLY published + non-deleted pages
 *   - createPage 409 when slug already exists
 *   - updatePage 404 when slug doesn't exist
 *   - publishPage stamps publishedAt the first time
 *   - deletePage soft-deletes (deletedAt + status=ARCHIVED)
 *   - body is sanitized before persist (XSS gate)
 *   - audit log written on every mutation
 *   - actor (adminId) recorded on every write
 */

import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../core/exceptions';
import { ContentService } from './content.service';

function basePage(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'page-1',
    slug: 'refund-policy',
    title: 'Refund Policy',
    body: '<p>Original</p>',
    metaTitle: null,
    metaDesc: null,
    canonicalUrl: null,
    ogImage: null,
    noIndex: false,
    published: false,
    publishedAt: null,
    status: 'DRAFT',
    deletedAt: null,
    createdById: null,
    updatedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeService() {
  const staticPage = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const faqEntry = {
    findUnique: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
  };
  const banner = {
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const prisma: any = { staticPage, faqEntry, banner };
  const audit = { record: jest.fn().mockResolvedValue(undefined), list: jest.fn() } as any;
  const service = new ContentService(prisma, audit);
  return { service, prisma, staticPage, faqEntry, audit };
}

describe('ContentService.getPageBySlug (Phase 49)', () => {
  it('filters published=true AND deletedAt=null', async () => {
    const { service, staticPage } = makeService();
    staticPage.findFirst.mockResolvedValueOnce(basePage({ published: true }));

    await service.getPageBySlug('refund-policy');

    expect(staticPage.findFirst).toHaveBeenCalledWith({
      where: { slug: 'refund-policy', published: true, deletedAt: null },
    });
  });

  it('throws NotFound for an unpublished page (draft leak fix)', async () => {
    const { service, staticPage } = makeService();
    staticPage.findFirst.mockResolvedValueOnce(null);
    await expect(service.getPageBySlug('refund-policy-draft')).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });
});

describe('ContentService.createPage (Phase 49)', () => {
  it('throws Conflict when slug already exists (not soft-deleted)', async () => {
    const { service, staticPage } = makeService();
    staticPage.findUnique.mockResolvedValueOnce(basePage());

    await expect(
      service.createPage({ slug: 'refund-policy', title: 'X', body: '<p>X</p>' }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('rejects an invalid slug (regex)', async () => {
    const { service } = makeService();
    await expect(
      service.createPage({ slug: 'Refund Policy', title: 'X', body: '<p>X</p>' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('sanitizes body before persist (strips <script>)', async () => {
    const { service, staticPage } = makeService();
    staticPage.findUnique.mockResolvedValueOnce(null);
    staticPage.create.mockImplementationOnce(async ({ data }: any) => basePage({ body: data.body }));

    await service.createPage({
      slug: 'refund',
      title: 'X',
      body: '<p>Hi</p><script>alert(1)</script>',
    });

    const persisted = staticPage.create.mock.calls[0][0].data.body;
    expect(persisted).not.toContain('<script');
    expect(persisted).not.toContain('alert');
  });

  it('stamps publishedAt when status=PUBLISHED on create', async () => {
    const { service, staticPage } = makeService();
    staticPage.findUnique.mockResolvedValueOnce(null);
    staticPage.create.mockImplementationOnce(async ({ data }: any) =>
      basePage({ published: true, publishedAt: data.publishedAt, status: 'PUBLISHED' }),
    );

    await service.createPage({
      slug: 'refund',
      title: 'X',
      body: '<p>X</p>',
      published: true,
    });

    expect(staticPage.create.mock.calls[0][0].data.publishedAt).toBeInstanceOf(Date);
    expect(staticPage.create.mock.calls[0][0].data.status).toBe('PUBLISHED');
  });

  it('records the actorId on create', async () => {
    const { service, staticPage, audit } = makeService();
    staticPage.findUnique.mockResolvedValueOnce(null);
    staticPage.create.mockResolvedValueOnce(basePage());

    await service.createPage(
      { slug: 'refund', title: 'X', body: '<p>X</p>' },
      'admin-7',
    );

    expect(staticPage.create.mock.calls[0][0].data.createdById).toBe('admin-7');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', actorId: 'admin-7' }),
    );
  });

  it('recovers a soft-deleted row via update instead of failing the unique constraint', async () => {
    const { service, staticPage } = makeService();
    staticPage.findUnique.mockResolvedValueOnce(
      basePage({ deletedAt: new Date(), status: 'ARCHIVED' }),
    );
    staticPage.update.mockResolvedValueOnce(basePage());

    await service.createPage({ slug: 'refund', title: 'X', body: '<p>X</p>' });

    expect(staticPage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'refund' },
        data: expect.objectContaining({ deletedAt: null }),
      }),
    );
  });
});

describe('ContentService.updatePage (Phase 49)', () => {
  it('throws NotFound when slug missing (no create-on-typo)', async () => {
    const { service, staticPage } = makeService();
    staticPage.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.updatePage('typo-policy', { title: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('throws NotFound when slug is soft-deleted', async () => {
    const { service, staticPage } = makeService();
    staticPage.findUnique.mockResolvedValueOnce(basePage({ deletedAt: new Date() }));
    await expect(
      service.updatePage('refund-policy', { title: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('sanitizes body on update', async () => {
    const { service, staticPage } = makeService();
    staticPage.findUnique.mockResolvedValueOnce(basePage());
    staticPage.update.mockImplementationOnce(async ({ data }: any) => basePage({ body: data.body }));

    await service.updatePage('refund-policy', {
      body: '<p>Safe</p><script>alert(1)</script>',
    });

    const persisted = staticPage.update.mock.calls[0][0].data.body;
    expect(persisted).not.toContain('<script');
  });

  it('records UPDATE audit row with prev + new title/body', async () => {
    const { service, staticPage, audit } = makeService();
    staticPage.findUnique.mockResolvedValueOnce(basePage({ title: 'Old', body: '<p>Old</p>' }));
    staticPage.update.mockResolvedValueOnce(basePage({ title: 'New', body: '<p>New</p>' }));

    await service.updatePage('refund-policy', { title: 'New', body: '<p>New</p>' });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        prevTitle: 'Old',
        newTitle: 'New',
      }),
    );
  });
});

describe('ContentService.publishPage (Phase 49)', () => {
  it('stamps publishedAt the first time', async () => {
    const { service, staticPage } = makeService();
    staticPage.findUnique.mockResolvedValueOnce(basePage({ publishedAt: null }));
    staticPage.update.mockImplementationOnce(async ({ data }: any) =>
      basePage({ ...data, publishedAt: data.publishedAt }),
    );

    await service.publishPage('refund-policy');

    expect(staticPage.update.mock.calls[0][0].data.publishedAt).toBeInstanceOf(Date);
    expect(staticPage.update.mock.calls[0][0].data.published).toBe(true);
    expect(staticPage.update.mock.calls[0][0].data.status).toBe('PUBLISHED');
  });

  it('does NOT re-stamp publishedAt on subsequent publishes', async () => {
    const earlier = new Date('2025-01-01T00:00:00Z');
    const { service, staticPage } = makeService();
    staticPage.findUnique.mockResolvedValueOnce(
      basePage({ publishedAt: earlier, published: false }),
    );
    staticPage.update.mockImplementationOnce(async ({ data }: any) =>
      basePage({ publishedAt: data.publishedAt }),
    );

    await service.publishPage('refund-policy');

    expect(staticPage.update.mock.calls[0][0].data.publishedAt).toEqual(earlier);
  });
});

describe('ContentService.unpublishPage (Phase 49)', () => {
  it('flips published=false + status=DRAFT but keeps publishedAt', async () => {
    const stamp = new Date('2026-01-01T00:00:00Z');
    const { service, staticPage } = makeService();
    staticPage.findUnique.mockResolvedValueOnce(
      basePage({ published: true, publishedAt: stamp, status: 'PUBLISHED' }),
    );
    staticPage.update.mockResolvedValueOnce(basePage({ published: false }));

    await service.unpublishPage('refund-policy');

    const data = staticPage.update.mock.calls[0][0].data;
    expect(data.published).toBe(false);
    expect(data.status).toBe('DRAFT');
    expect(data.publishedAt).toBeUndefined();
  });
});

describe('ContentService.deletePage (Phase 49)', () => {
  it('soft-deletes via deletedAt + ARCHIVED status', async () => {
    const { service, staticPage } = makeService();
    staticPage.findUnique.mockResolvedValueOnce(basePage());
    staticPage.update.mockResolvedValueOnce(undefined);

    await service.deletePage('refund-policy', 'admin-7');

    expect(staticPage.delete).not.toHaveBeenCalled();
    const data = staticPage.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.status).toBe('ARCHIVED');
    expect(data.published).toBe(false);
  });

  it('refuses to delete an already-soft-deleted page', async () => {
    const { service, staticPage } = makeService();
    staticPage.findUnique.mockResolvedValueOnce(basePage({ deletedAt: new Date() }));

    await expect(service.deletePage('refund-policy')).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });
});

describe('ContentService.restorePage (Phase 49)', () => {
  it('reverses a soft-delete', async () => {
    const { service, staticPage } = makeService();
    staticPage.findUnique.mockResolvedValueOnce(basePage({ deletedAt: new Date() }));
    staticPage.update.mockResolvedValueOnce(basePage());

    await service.restorePage('refund-policy');

    expect(staticPage.update.mock.calls[0][0].data.deletedAt).toBeNull();
    expect(staticPage.update.mock.calls[0][0].data.status).toBe('DRAFT');
  });

  it('refuses to restore a not-deleted page', async () => {
    const { service, staticPage } = makeService();
    staticPage.findUnique.mockResolvedValueOnce(basePage());

    await expect(service.restorePage('refund-policy')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });
});

describe('ContentService.listFaq + deleteFaq (Phase 49)', () => {
  it('listFaq filters deletedAt=null', async () => {
    const { service, faqEntry } = makeService();
    await service.listFaq('shipping');
    expect(faqEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          deletedAt: null,
          category: 'shipping',
        }),
      }),
    );
  });

  it('deleteFaq soft-deletes', async () => {
    const { service, faqEntry } = makeService();
    faqEntry.findUnique.mockResolvedValueOnce({
      id: 'faq-1',
      question: 'Q',
      answer: 'A',
      deletedAt: null,
    });
    faqEntry.update.mockResolvedValueOnce(undefined);

    await service.deleteFaq('faq-1');

    const data = faqEntry.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.active).toBe(false);
  });

  it('createFaq sanitizes the answer and strips HTML from the question', async () => {
    const { service, faqEntry } = makeService();
    faqEntry.create.mockImplementationOnce(async ({ data }: any) => ({
      id: 'x',
      ...data,
    }));

    await service.createFaq({
      category: 'shipping',
      question: '<script>alert(1)</script>How long?',
      answer: '<p>Usually 3 days</p><script>alert(2)</script>',
    });

    const data = faqEntry.create.mock.calls[0][0].data;
    expect(data.question).toBe('How long?');
    expect(data.answer).not.toContain('<script');
  });
});
