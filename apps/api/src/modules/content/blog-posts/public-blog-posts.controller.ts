import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BlogPostsService } from './blog-posts.service';

/**
 * Phase 50 (2026-05-21) — public blog read.
 *
 * Changes:
 *   - Service-layer Redis cache (60s, invalidated on admin writes).
 *   - Cache-Control headers hint CDN / ISR to cache for 60s with
 *     stale-while-revalidate=300. Storefront server-renders hit the
 *     cached payload most of the time.
 *   - Service filters soft-deleted posts (post-Phase-50 schema).
 */
@ApiTags('Storefront Blog Posts')
@Controller('storefront/blog-posts')
export class PublicBlogPostsController {
  constructor(private readonly service: BlogPostsService) {}

  @Get()
  @Header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  async list(@Query('page') page?: string, @Query('limit') limit?: string) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '12', 10) || 12));
    const data = await this.service.publicList({ page: pageNum, limit: limitNum });
    return { success: true, message: 'Blog posts', data };
  }

  @Get(':slug')
  @Header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  async getOne(@Param('slug') slug: string) {
    const post = await this.service.publicGetBySlug(slug);
    return { success: true, message: 'Blog post', data: post };
  }
}
