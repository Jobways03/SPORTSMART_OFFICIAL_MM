import { Injectable, Logger } from '@nestjs/common';
import type { BannerSlot, StaticPage, FaqEntry, PageStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../core/exceptions';
import {
  sanitizeCmsBody,
  stripHtmlToPlainText,
} from '../../core/utils/rich-text-sanitizer';
import { ContentPageAuditService } from './services/content-page-audit.service';
import {
  STATIC_PAGE_SLUG_PATTERN,
  STATIC_PAGE_SLUG_MESSAGE,
} from './dtos/static-page.dto';
import { FAQ_SLUG_PATTERN } from './dtos/banner.dto';

/**
 * Phase 49 (2026-05-21) — static-page + FAQ hardening.
 *
 * Read path:
 *   - getPageBySlug (public) filters `published=true AND deletedAt
 *     IS NULL`. Pre-Phase-49 drafts were publicly readable via
 *     direct URL.
 *   - listPages (admin) excludes soft-deleted rows by default.
 *
 * Write path:
 *   - createPage / updatePage replace the prior single PUT upsert.
 *     The old upsertPage stays as a back-compat wrapper for the
 *     legacy controller route.
 *   - publishPage stamps publishedAt + status=PUBLISHED + published=true.
 *   - unpublishPage flips status=DRAFT + published=false; publishedAt
 *     is kept for history.
 *   - deletePage soft-deletes (deletedAt + status=ARCHIVED).
 *   - restorePage reverses a soft-delete.
 *   - Body is sanitized via sanitizeCmsBody before persisting (XSS
 *     defence). metaTitle/metaDesc are HTML-stripped.
 *   - FAQ answer also sanitized; FAQ slug regex-validated.
 *   - Audit log row written for every mutation.
 *   - Actor (admin id) recorded on every write.
 */

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: ContentPageAuditService,
  ) {}

  // ── Banners (unchanged) ─────────────────────────────────────────

  async listBannersForSlot(slot: BannerSlot, scopeId?: string) {
    const now = new Date();
    return this.prisma.banner.findMany({
      where: {
        slot,
        active: true,
        ...(scopeId ? { scopeId } : {}),
        OR: [
          { startsAt: null, endsAt: null },
          { startsAt: { lte: now }, endsAt: null },
          { startsAt: null, endsAt: { gte: now } },
          { startsAt: { lte: now }, endsAt: { gte: now } },
        ],
      },
      orderBy: { position: 'asc' },
    });
  }

  listAllBanners() {
    return this.prisma.banner.findMany({ orderBy: [{ slot: 'asc' }, { position: 'asc' }] });
  }
  createBanner(data: any) { return this.prisma.banner.create({ data }); }
  updateBanner(id: string, data: any) { return this.prisma.banner.update({ where: { id }, data }); }
  deleteBanner(id: string) { return this.prisma.banner.delete({ where: { id } }); }

  // ── Static pages ───────────────────────────────────────────────

  /** Admin list: all non-deleted pages. */
  listPages() {
    return this.prisma.staticPage.findMany({
      where: { deletedAt: null },
      orderBy: { slug: 'asc' },
    });
  }

  /** Admin list including soft-deleted (for the Restore admin UI). */
  listAllPagesIncludingDeleted() {
    return this.prisma.staticPage.findMany({ orderBy: { slug: 'asc' } });
  }

  /**
   * Phase 49 — public read. Only returns published + non-deleted
   * pages. A draft or soft-deleted page returns 404 (not "draft
   * hidden") to avoid leaking that the slug exists at all.
   */
  async getPageBySlug(slug: string) {
    const page = await this.prisma.staticPage.findFirst({
      where: { slug, published: true, deletedAt: null },
    });
    if (!page) throw new NotFoundAppException('Page not found');
    return page;
  }

  /** Admin read — sees drafts and soft-deleted rows. */
  async getPageBySlugAdmin(slug: string) {
    const page = await this.prisma.staticPage.findUnique({ where: { slug } });
    if (!page) throw new NotFoundAppException('Page not found');
    return page;
  }

  /**
   * Phase 49 — back-compat upsert wrapper. The legacy PUT route
   * still calls this. New admin code should use createPage /
   * updatePage explicitly so a typo in the slug doesn't silently
   * create a draft (Gap #7).
   */
  async upsertPage(slug: string, data: UpsertPageInput, actorId?: string) {
    this.assertValidSlug(slug);
    const existing = await this.prisma.staticPage.findUnique({ where: { slug } });
    if (existing) {
      return this.updatePage(slug, data, actorId);
    }
    return this.createPage({ slug, ...data } as CreatePageInput, actorId);
  }

  async createPage(input: CreatePageInput, actorId?: string) {
    this.assertValidSlug(input.slug);
    const exists = await this.prisma.staticPage.findUnique({
      where: { slug: input.slug },
    });
    if (exists && !exists.deletedAt) {
      throw new ConflictAppException(
        `A static page with slug '${input.slug}' already exists`,
      );
    }
    const cleanBody = sanitizeCmsBody(input.body);
    const cleanMetaTitle = input.metaTitle
      ? stripHtmlToPlainText(input.metaTitle)
      : null;
    const cleanMetaDesc = input.metaDesc
      ? stripHtmlToPlainText(input.metaDesc)
      : null;

    const wantPublished = input.published === true || input.status === 'PUBLISHED';
    const data: Prisma.StaticPageCreateInput = {
      slug: input.slug,
      title: input.title,
      body: cleanBody,
      metaTitle: cleanMetaTitle,
      metaDesc: cleanMetaDesc,
      canonicalUrl: input.canonicalUrl ?? null,
      ogImage: input.ogImage ?? null,
      noIndex: input.noIndex ?? false,
      published: wantPublished,
      publishedAt: wantPublished ? new Date() : null,
      status: input.status ?? (wantPublished ? 'PUBLISHED' : 'DRAFT'),
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    };

    // Phase 49 — if a soft-deleted row exists for this slug, recover
    // it via update instead of failing the unique constraint.
    const row = exists?.deletedAt
      ? await this.prisma.staticPage.update({
          where: { slug: input.slug },
          data: { ...data, deletedAt: null },
        })
      : await this.prisma.staticPage.create({ data });

    await this.audit.record({
      resourceType: 'PAGE',
      resourceId: row.slug,
      action: 'CREATE',
      newTitle: row.title,
      newBody: row.body,
      actorId,
    });
    return row;
  }

  async updatePage(slug: string, input: UpdatePageInput, actorId?: string) {
    this.assertValidSlug(slug);
    const before = await this.prisma.staticPage.findUnique({ where: { slug } });
    if (!before || before.deletedAt) {
      throw new NotFoundAppException(`No live page found with slug '${slug}'`);
    }

    const data: Prisma.StaticPageUpdateInput = {
      updatedById: actorId ?? null,
    };
    if (input.title !== undefined) data.title = input.title;
    if (input.body !== undefined) data.body = sanitizeCmsBody(input.body);
    if (input.metaTitle !== undefined)
      data.metaTitle = input.metaTitle ? stripHtmlToPlainText(input.metaTitle) : null;
    if (input.metaDesc !== undefined)
      data.metaDesc = input.metaDesc ? stripHtmlToPlainText(input.metaDesc) : null;
    if (input.canonicalUrl !== undefined) data.canonicalUrl = input.canonicalUrl;
    if (input.ogImage !== undefined) data.ogImage = input.ogImage;
    if (input.noIndex !== undefined) data.noIndex = input.noIndex;
    if (input.status !== undefined) {
      data.status = input.status;
      // Keep `published` Boolean in lockstep with status (backward
      // compat with old reads that still check the boolean).
      if (input.status === 'PUBLISHED') {
        data.published = true;
        if (!before.publishedAt) data.publishedAt = new Date();
      } else if (input.status === 'DRAFT' || input.status === 'ARCHIVED') {
        data.published = false;
      }
    } else if (input.published !== undefined) {
      data.published = input.published;
      if (input.published === true) {
        data.status = 'PUBLISHED';
        if (!before.publishedAt) data.publishedAt = new Date();
      } else {
        data.status = 'DRAFT';
      }
    }

    const row = await this.prisma.staticPage.update({ where: { slug }, data });

    await this.audit.record({
      resourceType: 'PAGE',
      resourceId: row.slug,
      action: 'UPDATE',
      prevTitle: before.title,
      prevBody: before.body,
      newTitle: row.title,
      newBody: row.body,
      actorId,
    });
    return row;
  }

  /** Phase 49 — explicit publish. Stamps publishedAt the first time. */
  async publishPage(slug: string, actorId?: string) {
    const before = await this.prisma.staticPage.findUnique({ where: { slug } });
    if (!before || before.deletedAt) {
      throw new NotFoundAppException(`No live page found with slug '${slug}'`);
    }
    const row = await this.prisma.staticPage.update({
      where: { slug },
      data: {
        published: true,
        status: 'PUBLISHED',
        publishedAt: before.publishedAt ?? new Date(),
        updatedById: actorId ?? null,
      },
    });
    await this.audit.record({
      resourceType: 'PAGE',
      resourceId: row.slug,
      action: 'PUBLISH',
      prevTitle: before.title,
      newTitle: row.title,
      actorId,
    });
    return row;
  }

  async unpublishPage(slug: string, actorId?: string) {
    const before = await this.prisma.staticPage.findUnique({ where: { slug } });
    if (!before || before.deletedAt) {
      throw new NotFoundAppException(`No live page found with slug '${slug}'`);
    }
    const row = await this.prisma.staticPage.update({
      where: { slug },
      data: {
        published: false,
        status: 'DRAFT',
        // Keep publishedAt as-is so history of prior publication
        // is retained — matches the recommended audit-friendly
        // policy.
        updatedById: actorId ?? null,
      },
    });
    await this.audit.record({
      resourceType: 'PAGE',
      resourceId: row.slug,
      action: 'UNPUBLISH',
      prevTitle: before.title,
      actorId,
    });
    return row;
  }

  /**
   * Phase 49 — soft-delete instead of hard-delete. Audit log carries
   * the rollback target. Public reads filter deletedAt IS NULL.
   */
  async deletePage(slug: string, actorId?: string) {
    const before = await this.prisma.staticPage.findUnique({ where: { slug } });
    if (!before || before.deletedAt) {
      throw new NotFoundAppException(`No live page found with slug '${slug}'`);
    }
    await this.prisma.staticPage.update({
      where: { slug },
      data: {
        deletedAt: new Date(),
        published: false,
        status: 'ARCHIVED',
        updatedById: actorId ?? null,
      },
    });
    await this.audit.record({
      resourceType: 'PAGE',
      resourceId: slug,
      action: 'DELETE',
      prevTitle: before.title,
      prevBody: before.body,
      actorId,
    });
  }

  async restorePage(slug: string, actorId?: string): Promise<StaticPage> {
    const before = await this.prisma.staticPage.findUnique({ where: { slug } });
    if (!before) throw new NotFoundAppException(`No page found with slug '${slug}'`);
    if (!before.deletedAt) {
      throw new BadRequestAppException(`Page '${slug}' is not deleted`);
    }
    const row = await this.prisma.staticPage.update({
      where: { slug },
      data: {
        deletedAt: null,
        status: 'DRAFT',
        published: false,
        updatedById: actorId ?? null,
      },
    });
    await this.audit.record({
      resourceType: 'PAGE',
      resourceId: row.slug,
      action: 'RESTORE',
      newTitle: row.title,
      actorId,
    });
    return row;
  }

  // ── FAQ ─────────────────────────────────────────────────────────

  listFaq(category?: string) {
    return this.prisma.faqEntry.findMany({
      where: {
        active: true,
        deletedAt: null,
        ...(category ? { category } : {}),
      },
      orderBy: [{ category: 'asc' }, { position: 'asc' }],
    });
  }

  listAllFaq() {
    return this.prisma.faqEntry.findMany({
      where: { deletedAt: null },
      orderBy: [{ category: 'asc' }, { position: 'asc' }],
    });
  }

  async createFaq(input: CreateFaqInput, actorId?: string): Promise<FaqEntry> {
    if (input.slug) this.assertValidFaqSlug(input.slug);
    const data: Prisma.FaqEntryCreateInput = {
      category: input.category,
      slug: input.slug ?? null,
      question: stripHtmlToPlainText(input.question),
      answer: sanitizeCmsBody(input.answer),
      position: input.position ?? 0,
      active: input.active ?? true,
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    };
    const row = await this.prisma.faqEntry.create({ data });
    await this.audit.record({
      resourceType: 'FAQ',
      resourceId: row.id,
      action: 'CREATE',
      newTitle: row.question,
      newBody: row.answer,
      actorId,
    });
    return row;
  }

  async updateFaq(id: string, input: UpdateFaqInput, actorId?: string): Promise<FaqEntry> {
    if (input.slug) this.assertValidFaqSlug(input.slug);
    const before = await this.prisma.faqEntry.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundAppException(`FAQ entry '${id}' not found`);

    const data: Prisma.FaqEntryUpdateInput = { updatedById: actorId ?? null };
    if (input.category !== undefined) data.category = input.category;
    if (input.slug !== undefined) data.slug = input.slug;
    if (input.question !== undefined) data.question = stripHtmlToPlainText(input.question);
    if (input.answer !== undefined) data.answer = sanitizeCmsBody(input.answer);
    if (input.position !== undefined) data.position = input.position;
    if (input.active !== undefined) data.active = input.active;

    const row = await this.prisma.faqEntry.update({ where: { id }, data });
    await this.audit.record({
      resourceType: 'FAQ',
      resourceId: row.id,
      action: 'UPDATE',
      prevTitle: before.question,
      prevBody: before.answer,
      newTitle: row.question,
      newBody: row.answer,
      actorId,
    });
    return row;
  }

  async deleteFaq(id: string, actorId?: string): Promise<void> {
    const before = await this.prisma.faqEntry.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundAppException(`FAQ entry '${id}' not found`);
    await this.prisma.faqEntry.update({
      where: { id },
      data: { deletedAt: new Date(), active: false, updatedById: actorId ?? null },
    });
    await this.audit.record({
      resourceType: 'FAQ',
      resourceId: id,
      action: 'DELETE',
      prevTitle: before.question,
      prevBody: before.answer,
      actorId,
    });
  }

  async restoreFaq(id: string, actorId?: string): Promise<FaqEntry> {
    const before = await this.prisma.faqEntry.findUnique({ where: { id } });
    if (!before) throw new NotFoundAppException(`FAQ entry '${id}' not found`);
    if (!before.deletedAt) throw new BadRequestAppException(`FAQ entry '${id}' is not deleted`);
    const row = await this.prisma.faqEntry.update({
      where: { id },
      data: { deletedAt: null, active: false, updatedById: actorId ?? null },
    });
    await this.audit.record({
      resourceType: 'FAQ',
      resourceId: row.id,
      action: 'RESTORE',
      newTitle: row.question,
      actorId,
    });
    return row;
  }

  // ── helpers ──────────────────────────────────────────────────────

  private assertValidSlug(slug: string): void {
    if (!slug || !STATIC_PAGE_SLUG_PATTERN.test(slug)) {
      throw new BadRequestAppException(STATIC_PAGE_SLUG_MESSAGE);
    }
    if (slug.length > 80) {
      throw new BadRequestAppException('slug must be 80 characters or fewer');
    }
  }

  private assertValidFaqSlug(slug: string): void {
    if (!FAQ_SLUG_PATTERN.test(slug)) {
      throw new BadRequestAppException(
        'FAQ slug must be lowercase letters/numbers with hyphen separators',
      );
    }
  }
}

// Phase 49 — input shapes (loose; controllers pass either the DTO or
// the upsert shape).
export interface CreatePageInput {
  slug: string;
  title: string;
  body: string;
  metaTitle?: string | null;
  metaDesc?: string | null;
  canonicalUrl?: string | null;
  ogImage?: string | null;
  noIndex?: boolean;
  published?: boolean;
  status?: PageStatus;
}

export interface UpdatePageInput {
  title?: string;
  body?: string;
  metaTitle?: string | null;
  metaDesc?: string | null;
  canonicalUrl?: string | null;
  ogImage?: string | null;
  noIndex?: boolean;
  published?: boolean;
  status?: PageStatus;
}

export type UpsertPageInput = UpdatePageInput & {
  title: string;
  body: string;
};

export interface CreateFaqInput {
  category: string;
  slug?: string;
  question: string;
  answer: string;
  position?: number;
  active?: boolean;
}

export interface UpdateFaqInput {
  category?: string;
  slug?: string;
  question?: string;
  answer?: string;
  position?: number;
  active?: boolean;
}
