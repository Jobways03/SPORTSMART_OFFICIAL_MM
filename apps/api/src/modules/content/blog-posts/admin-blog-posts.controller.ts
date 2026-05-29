import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { BlogPostStatus } from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../../core/guards';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../core/decorators/idempotent.decorator';
import { BadRequestAppException } from '../../../core/exceptions';
import { BlogPostsService } from './blog-posts.service';
import { BlogPostAuditService } from './blog-post-audit.service';
import { CreateBlogPostDto, UpdateBlogPostDto } from './dtos/blog-post.dto';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  IMAGE_MULTER_OPTIONS,
  MAX_IMAGE_BYTES,
} from '../../catalog/presentation/controllers/_helpers/image-upload';

/**
 * Phase 50 (2026-05-21) — admin blog controller.
 *
 * Changes:
 *   - Uses shared IMAGE_MULTER_OPTIONS so the MIME allowlist runs in
 *     Multer's fileFilter (SVG and other non-image types rejected
 *     pre-upload, before the buffer hits memory).
 *   - DTOs are class-validator-backed (CreateBlogPostDto /
 *     UpdateBlogPostDto). Pre-Phase-50 the controller accepted
 *     interfaces which Nest's ValidationPipe couldn't validate.
 *   - New restore + history endpoints.
 *   - parseStatus accepts the full BlogPostStatus enum (incl
 *     SCHEDULED / ARCHIVED added in Phase 50).
 *   - @Idempotent() on POST create.
 */
@ApiTags('Admin Blog Posts')
@Controller('admin/blog-posts')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminBlogPostsController {
  constructor(
    private readonly service: BlogPostsService,
    private readonly audit: BlogPostAuditService,
  ) {}

  @Get()
  @Permissions('content.read')
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('includeDeleted') includeDeleted?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const statusFilter = this.parseStatus(status);
    const data = await this.service.adminList({
      page: pageNum,
      limit: limitNum,
      search,
      status: statusFilter,
      includeDeleted: includeDeleted === 'true',
    });
    return { success: true, message: 'Blog posts', data };
  }

  @Get(':id')
  @Permissions('content.read')
  async getOne(@Param('id') id: string) {
    const post = await this.service.adminGetById(id);
    return { success: true, message: 'Blog post', data: post };
  }

  @Get(':id/history')
  @Permissions('content.read')
  async history(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const entries = await this.audit.list(id, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { success: true, data: entries };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('content.write')
  @Idempotent()
  async create(@Body() body: CreateBlogPostDto, @Req() req: Request) {
    const adminId = (req as any).adminId as string | undefined;
    const post = await this.service.create(body, adminId);
    return { success: true, message: 'Blog post created', data: post };
  }

  @Patch(':id')
  @Permissions('content.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateBlogPostDto,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const post = await this.service.update(id, body, adminId);
    return { success: true, message: 'Blog post updated', data: post };
  }

  @Delete(':id')
  @Permissions('content.write')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const adminId = (req as any).adminId as string | undefined;
    await this.service.delete(id, adminId);
    return { success: true, message: 'Blog post deleted' };
  }

  @Post(':id/restore')
  @Permissions('content.write')
  async restore(@Param('id') id: string, @Req() req: Request) {
    const adminId = (req as any).adminId as string | undefined;
    const post = await this.service.restore(id, adminId);
    return { success: true, message: 'Blog post restored', data: post };
  }

  @Post(':id/upload')
  @Permissions('content.write')
  @UseInterceptors(FileInterceptor('image', IMAGE_MULTER_OPTIONS))
  async upload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestAppException('image file is required');
    // Defence-in-depth — the Multer fileFilter already enforces the
    // MIME allowlist, but a misconfigured interceptor would let it
    // through.
    if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new BadRequestAppException(
        `Only ${ALLOWED_IMAGE_MIME_TYPES.join(', ')} images are allowed`,
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestAppException('Image must not exceed 5MB');
    }
    const adminId = (req as any).adminId as string | undefined;
    const post = await this.service.uploadImage(id, file, adminId);
    return { success: true, message: 'Image uploaded', data: post };
  }

  private parseStatus(s?: string): BlogPostStatus | undefined {
    if (!s) return undefined;
    const upper = s.toUpperCase();
    const allowed: BlogPostStatus[] = [
      BlogPostStatus.VISIBLE,
      BlogPostStatus.HIDDEN,
      BlogPostStatus.SCHEDULED,
      BlogPostStatus.ARCHIVED,
    ];
    return allowed.includes(upper as BlogPostStatus) ? (upper as BlogPostStatus) : undefined;
  }
}
