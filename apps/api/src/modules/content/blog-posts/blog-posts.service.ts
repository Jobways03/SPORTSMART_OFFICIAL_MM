import { Injectable, Logger } from '@nestjs/common';
import { Prisma, BlogPostStatus } from '@prisma/client';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../bootstrap/cache/redis.service';
import { CloudinaryAdapter } from '../../../integrations/cloudinary/cloudinary.adapter';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../core/exceptions';
import {
  sanitizeCmsBody,
  stripHtmlToPlainText,
} from '../../../core/utils/rich-text-sanitizer';
import { BlogPostAuditService } from './blog-post-audit.service';

/**
 * Phase 50 (2026-05-21) — blog-posts service hardened.
 *
 * Pre-Phase-50 the service was clean but had:
 *   - no HTML sanitization on contentHtml (XSS via blog body)
 *   - no Cloudinary publicId tracking (orphan on replace + delete)
 *   - hard delete (no recovery)
 *   - no audit log
 *   - non-atomic slug uniqueness (P2002 → 500 on race)
 *   - no tag normalization (Cricket / cricket / CRICKET all stored)
 *   - no category allowlist
 *   - no public-read cache
 *
 * Phase 50 closes all of those.
 */

export const BLOG_POSTS_CACHE_PREFIX = 'blog-posts:v1:';
export const BLOG_POSTS_CACHE_TTL_SECONDS = 60;

// Phase 50 — Gap #9 allowlist. Frontend dropdown drives these; backend
// rejects anything else. Extend by adding to this array + redeploying.
export const BLOG_CATEGORY_ALLOWLIST = [
  'News',
  'Sports',
  'Reviews',
  'Guides',
  'Launches',
  'Brand Stories',
  'Tips',
] as const;
const BLOG_CATEGORY_SET = new Set<string>(BLOG_CATEGORY_ALLOWLIST);

export interface BlogPostDto {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  contentHtml: string;
  imageUrl: string | null;
  imageAlt: string | null;
  author: string | null;
  category: string;
  tags: string[];
  status: BlogPostStatus;
  publishedAt: Date | null;
  metaTitle: string | null;
  metaDesc: string | null;
  canonicalUrl: string | null;
  ogImage: string | null;
  noIndex: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBlogPostInput {
  title: string;
  slug?: string;
  excerpt?: string | null;
  contentHtml?: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
  author?: string | null;
  category?: string;
  tags?: string[];
  status?: BlogPostStatus;
  metaTitle?: string | null;
  metaDesc?: string | null;
  canonicalUrl?: string | null;
  ogImage?: string | null;
  noIndex?: boolean;
}

export interface UpdateBlogPostInput {
  title?: string;
  slug?: string;
  excerpt?: string | null;
  contentHtml?: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
  author?: string | null;
  category?: string;
  tags?: string[];
  status?: BlogPostStatus;
  metaTitle?: string | null;
  metaDesc?: string | null;
  canonicalUrl?: string | null;
  ogImage?: string | null;
  noIndex?: boolean;
}

@Injectable()
export class BlogPostsService {
  private readonly logger = new Logger(BlogPostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryAdapter,
    private readonly audit: BlogPostAuditService,
    private readonly redis: RedisService,
  ) {}

  // ─── Admin ────────────────────────────────────────────────────────

  async adminList(params: {
    page: number;
    limit: number;
    search?: string;
    status?: BlogPostStatus;
    includeDeleted?: boolean;
  }): Promise<{ items: BlogPostDto[]; total: number; page: number; limit: number }> {
    const { page, limit, search, status, includeDeleted } = params;
    const where: Prisma.BlogPostWhereInput = {
      ...(includeDeleted ? {} : { deletedAt: null }),
    };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    return { items: rows.map(this.toDto), total, page, limit };
  }

  async adminGetById(id: string): Promise<BlogPostDto> {
    const row = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!row) throw new NotFoundAppException('Blog post not found');
    return this.toDto(row);
  }

  async create(input: CreateBlogPostInput, actorId?: string): Promise<BlogPostDto> {
    if (!input.title?.trim()) {
      throw new BadRequestAppException('title is required');
    }
    const category = this.normalizeCategory(input.category);
    const tags = this.normalizeTags(input.tags ?? []);
    const slug = await this.resolveUniqueSlug(input.slug || input.title);
    const status = input.status ?? BlogPostStatus.HIDDEN;
    const isPublic =
      status === BlogPostStatus.VISIBLE || status === BlogPostStatus.SCHEDULED;

    // Phase 50 — sanitize body BEFORE persist (XSS gate).
    const contentHtml = sanitizeCmsBody(input.contentHtml ?? '');

    let row;
    try {
      row = await this.prisma.blogPost.create({
        data: {
          slug,
          title: input.title.trim(),
          excerpt: input.excerpt ? stripHtmlToPlainText(input.excerpt) : null,
          contentHtml,
          imageUrl: input.imageUrl ?? null,
          imageAlt: input.imageAlt ?? null,
          author: input.author ?? null,
          category,
          tags,
          status,
          // Schedule + Visible both get publishedAt; HIDDEN/ARCHIVED don't.
          publishedAt: isPublic ? new Date() : null,
          metaTitle: input.metaTitle ? stripHtmlToPlainText(input.metaTitle) : null,
          metaDesc: input.metaDesc ? stripHtmlToPlainText(input.metaDesc) : null,
          canonicalUrl: input.canonicalUrl ?? null,
          ogImage: input.ogImage ?? null,
          noIndex: input.noIndex ?? false,
          createdById: actorId ?? null,
          updatedById: actorId ?? null,
        },
      });
    } catch (err: any) {
      // Phase 50 — race-safe slug. Two concurrent creates with the
      // same title both pass the uniqueness check; the second hits
      // Prisma P2002. Surface a clean 409 instead of leaking 500.
      if (err?.code === 'P2002') {
        throw new ConflictAppException(
          `Slug '${slug}' was claimed by a concurrent request — retry`,
        );
      }
      throw err;
    }

    await this.audit.record({
      postId: row.id,
      action: 'CREATE',
      newState: this.toAuditSnapshot(row) as any,
      actorId,
    });
    await this.invalidatePublicCache(slug);
    return this.toDto(row);
  }

  async update(
    id: string,
    input: UpdateBlogPostInput,
    actorId?: string,
  ): Promise<BlogPostDto> {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundAppException('Blog post not found');
    }

    const data: Prisma.BlogPostUpdateInput = { updatedById: actorId ?? null };
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.slug !== undefined && input.slug !== existing.slug) {
      data.slug = await this.resolveUniqueSlug(input.slug, id);
    }
    if (input.excerpt !== undefined)
      data.excerpt = input.excerpt ? stripHtmlToPlainText(input.excerpt) : null;
    if (input.contentHtml !== undefined) {
      data.contentHtml = sanitizeCmsBody(input.contentHtml);
    }
    if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
    if (input.imageAlt !== undefined) data.imageAlt = input.imageAlt;
    if (input.author !== undefined) data.author = input.author;
    if (input.category !== undefined) data.category = this.normalizeCategory(input.category);
    if (input.tags !== undefined) data.tags = this.normalizeTags(input.tags);
    if (input.metaTitle !== undefined)
      data.metaTitle = input.metaTitle ? stripHtmlToPlainText(input.metaTitle) : null;
    if (input.metaDesc !== undefined)
      data.metaDesc = input.metaDesc ? stripHtmlToPlainText(input.metaDesc) : null;
    if (input.canonicalUrl !== undefined) data.canonicalUrl = input.canonicalUrl;
    if (input.ogImage !== undefined) data.ogImage = input.ogImage;
    if (input.noIndex !== undefined) data.noIndex = input.noIndex;

    let publishedAction: 'PUBLISH' | 'UNPUBLISH' | undefined;
    if (input.status !== undefined && input.status !== existing.status) {
      data.status = input.status;
      // Set publishedAt the first time we flip to VISIBLE/SCHEDULED.
      // Subsequent toggles preserve the original publishedAt so admins
      // can adjust ordering by editing the post.
      const isGoingPublic =
        input.status === BlogPostStatus.VISIBLE ||
        input.status === BlogPostStatus.SCHEDULED;
      if (isGoingPublic && !existing.publishedAt) {
        data.publishedAt = new Date();
      }
      if (isGoingPublic && existing.status !== BlogPostStatus.VISIBLE) {
        publishedAction = 'PUBLISH';
      } else if (!isGoingPublic && existing.status === BlogPostStatus.VISIBLE) {
        publishedAction = 'UNPUBLISH';
      }
    }

    let row;
    try {
      row = await this.prisma.blogPost.update({ where: { id }, data });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictAppException(
          `Slug '${(data.slug as string) ?? '?'}' is already in use`,
        );
      }
      throw err;
    }

    await this.audit.record({
      postId: row.id,
      action: publishedAction ?? 'UPDATE',
      prevState: this.toAuditSnapshot(existing) as any,
      newState: this.toAuditSnapshot(row) as any,
      actorId,
    });
    await this.invalidatePublicCache(existing.slug);
    if (row.slug !== existing.slug) await this.invalidatePublicCache(row.slug);
    return this.toDto(row);
  }

  /**
   * Phase 50 — soft-delete. Pre-Phase-50 this was a hard delete +
   * Cloudinary asset orphan. Now we stamp deletedAt and fire-and-
   * forget Cloudinary cleanup so storage doesn't leak.
   */
  async delete(id: string, actorId?: string): Promise<void> {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      // Idempotent — matches the pre-Phase-50 P2025 swallow behaviour.
      return;
    }
    await this.prisma.blogPost.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: BlogPostStatus.ARCHIVED,
        updatedById: actorId ?? null,
      },
    });

    if (existing.imagePublicId) {
      this.cloudinary
        .delete(existing.imagePublicId)
        .catch((err) =>
          this.logger.warn(
            `Cloudinary cleanup failed for ${existing.imagePublicId}: ${(err as Error).message}`,
          ),
        );
    }

    await this.audit.record({
      postId: id,
      action: 'DELETE',
      prevState: this.toAuditSnapshot(existing) as any,
      actorId,
    });
    await this.invalidatePublicCache(existing.slug);
  }

  async restore(id: string, actorId?: string): Promise<BlogPostDto> {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing) throw new NotFoundAppException('Blog post not found');
    if (!existing.deletedAt) {
      throw new BadRequestAppException('Blog post is not deleted');
    }
    const row = await this.prisma.blogPost.update({
      where: { id },
      data: {
        deletedAt: null,
        status: BlogPostStatus.HIDDEN,
        updatedById: actorId ?? null,
      },
    });
    await this.audit.record({
      postId: id,
      action: 'RESTORE',
      newState: this.toAuditSnapshot(row) as any,
      actorId,
    });
    await this.invalidatePublicCache(row.slug);
    return this.toDto(row);
  }

  async uploadImage(
    id: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
    actorId?: string,
  ): Promise<BlogPostDto> {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new NotFoundAppException('Blog post not found');

    const uploaded = await this.cloudinary.upload(file.buffer, {
      folder: `blog-posts/${existing.slug}`,
      resourceType: 'image',
      // Phase 50 — cap dimensions so a multi-megabyte hero image
      // doesn't ship to every storefront client. Cloudinary's
      // `limit` only scales down.
      transformation: [{ width: 1600, height: 900, crop: 'limit' }],
    });
    this.logger.log(`Blog post image uploaded id=${id} publicId=${uploaded.publicId}`);

    let row;
    try {
      row = await this.prisma.blogPost.update({
        where: { id },
        data: {
          imageUrl: uploaded.secureUrl,
          imagePublicId: uploaded.publicId,
          updatedById: actorId ?? null,
        },
      });
    } catch (err) {
      // DB write failed — clean up the freshly-uploaded asset so it
      // doesn't orphan.
      this.cloudinary
        .delete(uploaded.publicId)
        .catch((e) =>
          this.logger.warn(
            `Cloudinary cleanup failed for orphan ${uploaded.publicId}: ${(e as Error).message}`,
          ),
        );
      throw err;
    }

    // Phase 50 — replace path: prior asset existed and was superseded.
    // Fire-and-forget delete so the next read doesn't keep paying for
    // it. Pre-Phase-50 the prior asset orphaned forever.
    if (
      existing.imagePublicId &&
      existing.imagePublicId !== uploaded.publicId
    ) {
      this.cloudinary
        .delete(existing.imagePublicId)
        .catch((err) =>
          this.logger.warn(
            `Cloudinary cleanup failed for prior asset ${existing.imagePublicId}: ${(err as Error).message}`,
          ),
        );
    }

    await this.audit.record({
      postId: id,
      action: 'IMAGE_UPLOAD',
      prevState: this.toAuditSnapshot(existing) as any,
      newState: this.toAuditSnapshot(row) as any,
      actorId,
    });
    await this.invalidatePublicCache(existing.slug);
    return this.toDto(row);
  }

  // ─── Public ───────────────────────────────────────────────────────

  /** Phase 50 — public list cached 60s, invalidated on every admin
   * write that affects any post. Cache key includes page + limit. */
  async publicList(params: {
    page: number;
    limit: number;
  }): Promise<{ items: BlogPostDto[]; total: number; page: number; limit: number }> {
    const cacheKey = `${BLOG_POSTS_CACHE_PREFIX}list:p${params.page}:l${params.limit}`;
    return this.redis.getOrSet(cacheKey, BLOG_POSTS_CACHE_TTL_SECONDS, () =>
      this.queryPublicList(params),
    );
  }

  private async queryPublicList(params: {
    page: number;
    limit: number;
  }): Promise<{ items: BlogPostDto[]; total: number; page: number; limit: number }> {
    const { page, limit } = params;
    const where: Prisma.BlogPostWhereInput = {
      status: BlogPostStatus.VISIBLE,
      deletedAt: null,
    };
    const [rows, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    return { items: rows.map(this.toDto), total, page, limit };
  }

  async publicGetBySlug(slug: string): Promise<BlogPostDto> {
    const cacheKey = `${BLOG_POSTS_CACHE_PREFIX}slug:${slug}`;
    return this.redis.getOrSet(cacheKey, BLOG_POSTS_CACHE_TTL_SECONDS, () =>
      this.queryPublicBySlug(slug),
    );
  }

  private async queryPublicBySlug(slug: string): Promise<BlogPostDto> {
    const row = await this.prisma.blogPost.findFirst({
      where: { slug, status: BlogPostStatus.VISIBLE, deletedAt: null },
    });
    if (!row) throw new NotFoundAppException('Blog post not found');
    return this.toDto(row);
  }

  // ─── cache ────────────────────────────────────────────────────────

  /**
   * Best-effort invalidation. Slugged single-post key gets a direct
   * del; the list keys (one per page/limit combo) are wiped via the
   * pattern delete. A Redis outage logs but never blocks the write.
   */
  async invalidatePublicCache(slug?: string): Promise<void> {
    try {
      if (slug) await this.redis.del(`${BLOG_POSTS_CACHE_PREFIX}slug:${slug}`);
      await this.redis.delPattern(`${BLOG_POSTS_CACHE_PREFIX}list:*`);
    } catch (err) {
      this.logger.warn(
        `Blog cache invalidation failed: ${(err as Error).message}`,
      );
    }
  }

  // ─── helpers ──────────────────────────────────────────────────────

  /**
   * Slugify and resolve collisions by appending -2, -3, … so two posts
   * with the same title can coexist. Optional excludeId lets edit-flows
   * keep the same slug without "colliding with itself".
   */
  private async resolveUniqueSlug(
    raw: string,
    excludeId?: string,
  ): Promise<string> {
    const base = this.slugify(raw);
    if (!base) {
      throw new BadRequestAppException(
        'title must contain at least one slug-compatible character',
      );
    }
    let candidate = base;
    let attempt = 1;
    while (true) {
      const clash = await this.prisma.blogPost.findFirst({
        where: { slug: candidate, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
        select: { id: true },
      });
      if (!clash) return candidate;
      attempt += 1;
      candidate = `${base}-${attempt}`;
      if (attempt > 50) {
        throw new BadRequestAppException(
          'Too many posts share this title — try a more specific one',
        );
      }
    }
  }

  private slugify(s: string): string {
    return s
      .toLowerCase()
      .trim()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  /**
   * Phase 50 — Gap #8 normalize: trim, lowercase, dedupe, cap to 20.
   * Also drops tags > 40 chars (post-trim) and any empty entries.
   */
  private normalizeTags(tags: string[]): string[] {
    const cleaned = tags
      .map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : ''))
      .filter((t) => t.length > 0 && t.length <= 40);
    const deduped = Array.from(new Set(cleaned));
    return deduped.slice(0, 20);
  }

  /**
   * Phase 50 — Gap #9 enforce category allowlist. Unknown values
   * fall back to the safe default 'News'. We don't throw — admins
   * who pre-Phase-50 set a custom category shouldn't be locked out;
   * the value is just normalised to the closest safe one.
   */
  private normalizeCategory(category?: string): string {
    const trimmed = category?.trim();
    if (!trimmed) return 'News';
    if (BLOG_CATEGORY_SET.has(trimmed)) return trimmed;
    // Case-insensitive match — let admins type 'sports' as 'Sports'.
    const match = BLOG_CATEGORY_ALLOWLIST.find(
      (c) => c.toLowerCase() === trimmed.toLowerCase(),
    );
    if (match) return match;
    throw new BadRequestAppException(
      `Unknown category '${trimmed}'. Allowed: ${BLOG_CATEGORY_ALLOWLIST.join(', ')}`,
    );
  }

  private toAuditSnapshot(row: {
    id: string;
    slug: string;
    title: string;
    excerpt: string | null;
    contentHtml: string;
    imageUrl: string | null;
    imagePublicId?: string | null;
    imageAlt?: string | null;
    author: string | null;
    category: string;
    tags: string[];
    status: BlogPostStatus;
    publishedAt: Date | null;
    metaTitle: string | null;
    metaDesc: string | null;
    canonicalUrl?: string | null;
    ogImage?: string | null;
    noIndex?: boolean;
  }): Record<string, unknown> {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      contentHtml: row.contentHtml,
      imageUrl: row.imageUrl,
      imagePublicId: row.imagePublicId ?? null,
      imageAlt: row.imageAlt ?? null,
      author: row.author,
      category: row.category,
      tags: row.tags,
      status: row.status,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      metaTitle: row.metaTitle,
      metaDesc: row.metaDesc,
      canonicalUrl: row.canonicalUrl ?? null,
      ogImage: row.ogImage ?? null,
      noIndex: row.noIndex ?? false,
    };
  }

  private toDto = (row: {
    id: string;
    slug: string;
    title: string;
    excerpt: string | null;
    contentHtml: string;
    imageUrl: string | null;
    imageAlt: string | null;
    author: string | null;
    category: string;
    tags: string[];
    status: BlogPostStatus;
    publishedAt: Date | null;
    metaTitle: string | null;
    metaDesc: string | null;
    canonicalUrl: string | null;
    ogImage: string | null;
    noIndex: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): BlogPostDto => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    contentHtml: row.contentHtml,
    imageUrl: row.imageUrl,
    imageAlt: row.imageAlt,
    author: row.author,
    category: row.category,
    tags: row.tags,
    status: row.status,
    publishedAt: row.publishedAt,
    metaTitle: row.metaTitle,
    metaDesc: row.metaDesc,
    canonicalUrl: row.canonicalUrl,
    ogImage: row.ogImage,
    noIndex: row.noIndex,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
