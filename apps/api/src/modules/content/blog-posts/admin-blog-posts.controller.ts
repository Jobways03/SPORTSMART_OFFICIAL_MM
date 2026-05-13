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
import { BadRequestAppException } from '../../../core/exceptions';
import {
  BlogPostsService,
  CreateBlogPostInput,
  UpdateBlogPostInput,
} from './blog-posts.service';

const MULTER_OPTIONS = { limits: { fileSize: 5 * 1024 * 1024 } };

@ApiTags('Admin Blog Posts')
@Controller('admin/blog-posts')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminBlogPostsController {
  constructor(private readonly service: BlogPostsService) {}

  @Get()
  @Permissions('content.read')
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const statusFilter = this.parseStatus(status);
    const data = await this.service.adminList({
      page: pageNum,
      limit: limitNum,
      search,
      status: statusFilter,
    });
    return { success: true, message: 'Blog posts', data };
  }

  @Get(':id')
  @Permissions('content.read')
  async getOne(@Param('id') id: string) {
    const post = await this.service.adminGetById(id);
    return { success: true, message: 'Blog post', data: post };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('content.write')
  async create(@Body() body: CreateBlogPostInput, @Req() req: Request) {
    const adminId = (req as any).adminId as string | undefined;
    const post = await this.service.create(body, adminId);
    return { success: true, message: 'Blog post created', data: post };
  }

  @Patch(':id')
  @Permissions('content.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateBlogPostInput,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const post = await this.service.update(id, body, adminId);
    return { success: true, message: 'Blog post updated', data: post };
  }

  @Delete(':id')
  @Permissions('content.write')
  async remove(@Param('id') id: string) {
    await this.service.delete(id);
    return { success: true, message: 'Blog post deleted' };
  }

  @Post(':id/upload')
  @Permissions('content.write')
  @UseInterceptors(FileInterceptor('image', MULTER_OPTIONS))
  async upload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestAppException('image file is required');
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestAppException('uploaded file must be an image');
    }
    const adminId = (req as any).adminId as string | undefined;
    const post = await this.service.uploadImage(id, file, adminId);
    return { success: true, message: 'Image uploaded', data: post };
  }

  private parseStatus(s?: string): BlogPostStatus | undefined {
    if (!s) return undefined;
    const upper = s.toUpperCase();
    if (upper === 'VISIBLE' || upper === 'HIDDEN') return upper as BlogPostStatus;
    return undefined;
  }
}
