import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../bootstrap/database/prisma.service';

/**
 * Phase 50 (2026-05-21) — best-effort writes to blog_post_audit_logs.
 * Used by BlogPostsService on every CREATE / UPDATE / DELETE /
 * PUBLISH / UNPUBLISH / IMAGE_UPLOAD / RESTORE transition so
 * editorial + legal can answer "who changed this post and when"
 * without trawling app logs.
 *
 * Best-effort: a failure logs but does NOT throw — the source of
 * truth is the blog post row itself; the audit log is the mirror.
 */

export type BlogPostAuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'PUBLISH'
  | 'UNPUBLISH'
  | 'IMAGE_UPLOAD'
  | 'RESTORE';

@Injectable()
export class BlogPostAuditService {
  private readonly logger = new Logger(BlogPostAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: {
    postId: string;
    action: BlogPostAuditAction;
    prevState?: Prisma.InputJsonValue | null;
    newState?: Prisma.InputJsonValue | null;
    actorId?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.blogPostAuditLog.create({
        data: {
          postId: entry.postId,
          action: entry.action,
          prevState: entry.prevState ?? undefined,
          newState: entry.newState ?? undefined,
          actorId: entry.actorId ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `BlogPostAuditLog write failed for ${entry.postId} action=${entry.action}: ${(err as Error).message}`,
      );
    }
  }

  async list(
    postId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<unknown[]> {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const skip = Math.max(opts.offset ?? 0, 0);
    return this.prisma.blogPostAuditLog.findMany({
      where: { postId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }
}
