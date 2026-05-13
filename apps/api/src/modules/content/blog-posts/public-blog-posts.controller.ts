import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BlogPostsService } from './blog-posts.service';

@ApiTags('Storefront Blog Posts')
@Controller('storefront/blog-posts')
export class PublicBlogPostsController {
  constructor(private readonly service: BlogPostsService) {}

  @Get()
  async list(@Query('page') page?: string, @Query('limit') limit?: string) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '12', 10) || 12));
    const data = await this.service.publicList({ page: pageNum, limit: limitNum });
    return { success: true, message: 'Blog posts', data };
  }

  @Get(':slug')
  async getOne(@Param('slug') slug: string) {
    const post = await this.service.publicGetBySlug(slug);
    return { success: true, message: 'Blog post', data: post };
  }
}
