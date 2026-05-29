import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ReviewStatus } from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../core/guards';
import { Permissions } from '../../core/decorators/permissions.decorator';
import { ProductReviewsService } from './product-reviews.service';

// Admin moderation queue + actions. Reuses the `content.*` permission
// set since reviews are user-generated content the marketing/CX team
// already moderates alongside blog posts and CMS blocks.
@ApiTags('Admin Product Reviews')
@Controller('admin/product-reviews')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminProductReviewsController {
  constructor(private readonly service: ProductReviewsService) {}

  @Get()
  @Permissions('content.read')
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('productSlug') productSlug?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const data = await this.service.adminList({
      page: pageNum,
      limit: limitNum,
      status: this.parseStatus(status),
      productSlug,
    });
    return { success: true, message: 'Reviews', data };
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('content.write')
  async approve(
    @Param('id') id: string,
    @Req() req: Request & { adminId?: string },
  ) {
    const data = await this.service.approve(id, req.adminId as string);
    return { success: true, message: 'Review approved', data };
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('content.write')
  async reject(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: Request & { adminId?: string },
  ) {
    const data = await this.service.reject(
      id,
      req.adminId as string,
      body?.reason,
    );
    return { success: true, message: 'Review rejected', data };
  }

  @Delete(':id')
  @Permissions('content.write')
  async remove(@Param('id') id: string) {
    await this.service.delete(id);
    return { success: true, message: 'Review deleted' };
  }

  private parseStatus(s?: string): ReviewStatus | undefined {
    if (!s) return undefined;
    const upper = s.toUpperCase();
    if (
      upper === 'PENDING' ||
      upper === 'APPROVED' ||
      upper === 'REJECTED'
    ) {
      return upper as ReviewStatus;
    }
    return undefined;
  }
}
