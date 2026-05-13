import { Injectable, Logger } from '@nestjs/common';
import { Prisma, BlogPostStatus } from '@prisma/client';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { CloudinaryAdapter } from '../../../integrations/cloudinary/cloudinary.adapter';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../core/exceptions';

export interface BlogPostDto {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  contentHtml: string;
  imageUrl: string | null;
  author: string | null;
  category: string;
  tags: string[];
  status: BlogPostStatus;
  publishedAt: Date | null;
  metaTitle: string | null;
  metaDesc: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBlogPostInput {
  title: string;
  slug?: string;
  excerpt?: string | null;
  contentHtml?: string;
  imageUrl?: string | null;
  author?: string | null;
  category?: string;
  tags?: string[];
  status?: BlogPostStatus;
  metaTitle?: string | null;
  metaDesc?: string | null;
}

export interface UpdateBlogPostInput {
  title?: string;
  slug?: string;
  excerpt?: string | null;
  contentHtml?: string;
  imageUrl?: string | null;
  author?: string | null;
  category?: string;
  tags?: string[];
  status?: BlogPostStatus;
  metaTitle?: string | null;
  metaDesc?: string | null;
}

@Injectable()
export class BlogPostsService {
  private readonly logger = new Logger(BlogPostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryAdapter,
  ) {}

  // ─── Admin ────────────────────────────────────────────────────────

  async adminList(params: {
    page: number;
    limit: number;
    search?: string;
    status?: BlogPostStatus;
  }): Promise<{ items: BlogPostDto[]; total: number; page: number; limit: number }> {
    const { page, limit, search, status } = params;
    const where: Prisma.BlogPostWhereInput = {};
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
    const slug = await this.resolveUniqueSlug(input.slug || input.title);
    const status = input.status ?? BlogPostStatus.HIDDEN;
    const row = await this.prisma.blogPost.create({
      data: {
        slug,
        title: input.title.trim(),
        excerpt: input.excerpt ?? null,
        contentHtml: input.contentHtml ?? '',
        imageUrl: input.imageUrl ?? null,
        author: input.author ?? null,
        category: input.category?.trim() || 'News',
        tags: input.tags ?? [],
        status,
        publishedAt: status === BlogPostStatus.VISIBLE ? new Date() : null,
        metaTitle: input.metaTitle ?? null,
        metaDesc: input.metaDesc ?? null,
        createdById: actorId ?? null,
        updatedById: actorId ?? null,
      },
    });
    return this.toDto(row);
  }

  async update(
    id: string,
    input: UpdateBlogPostInput,
    actorId?: string,
  ): Promise<BlogPostDto> {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing) throw new NotFoundAppException('Blog post not found');

    const data: Prisma.BlogPostUpdateInput = { updatedById: actorId ?? null };
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.slug !== undefined && input.slug !== existing.slug) {
      data.slug = await this.resolveUniqueSlug(input.slug, id);
    }
    if (input.excerpt !== undefined) data.excerpt = input.excerpt;
    if (input.contentHtml !== undefined) data.contentHtml = input.contentHtml;
    if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
    if (input.author !== undefined) data.author = input.author;
    if (input.category !== undefined) data.category = input.category.trim() || 'News';
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.metaTitle !== undefined) data.metaTitle = input.metaTitle;
    if (input.metaDesc !== undefined) data.metaDesc = input.metaDesc;

    if (input.status !== undefined && input.status !== existing.status) {
      data.status = input.status;
      // Set publishedAt the first time we flip to VISIBLE so the
      // public list can sort by published date stably. If it's been
      // published before and we're re-publishing, keep the original
      // publishedAt — admins can adjust ordering by editing the post.
      if (input.status === BlogPostStatus.VISIBLE && !existing.publishedAt) {
        data.publishedAt = new Date();
      }
    }

    const row = await this.prisma.blogPost.update({ where: { id }, data });
    return this.toDto(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.blogPost.delete({ where: { id } }).catch((err) => {
      if ((err as { code?: string })?.code !== 'P2025') throw err;
    });
  }

  async uploadImage(
    id: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
    actorId?: string,
  ): Promise<BlogPostDto> {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing) throw new NotFoundAppException('Blog post not found');
    const uploaded = await this.cloudinary.upload(file.buffer, {
      folder: `blog-posts/${existing.slug}`,
      resourceType: 'image',
    });
    this.logger.log(`Blog post image uploaded id=${id} url=${uploaded.secureUrl}`);
    return this.update(id, { imageUrl: uploaded.secureUrl }, actorId);
  }

  // ─── Public ───────────────────────────────────────────────────────

  async publicList(params: {
    page: number;
    limit: number;
  }): Promise<{ items: BlogPostDto[]; total: number; page: number; limit: number }> {
    const { page, limit } = params;
    const where: Prisma.BlogPostWhereInput = { status: BlogPostStatus.VISIBLE };
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
    const row = await this.prisma.blogPost.findFirst({
      where: { slug, status: BlogPostStatus.VISIBLE },
    });
    if (!row) throw new NotFoundAppException('Blog post not found');
    return this.toDto(row);
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

  private toDto = (row: {
    id: string;
    slug: string;
    title: string;
    excerpt: string | null;
    contentHtml: string;
    imageUrl: string | null;
    author: string | null;
    category: string;
    tags: string[];
    status: BlogPostStatus;
    publishedAt: Date | null;
    metaTitle: string | null;
    metaDesc: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): BlogPostDto => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    contentHtml: row.contentHtml,
    imageUrl: row.imageUrl,
    author: row.author,
    category: row.category,
    tags: row.tags,
    status: row.status,
    publishedAt: row.publishedAt,
    metaTitle: row.metaTitle,
    metaDesc: row.metaDesc,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
