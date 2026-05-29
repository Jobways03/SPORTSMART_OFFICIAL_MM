import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { BannerSlot } from '@prisma/client';
import type { Request } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../core/guards';
import { Permissions } from '../../core/decorators/permissions.decorator';
import { ContentService } from './content.service';
import {
  CreateBannerDto,
  UpdateBannerDto,
  CreateFaqDto,
  UpdateFaqDto,
} from './dtos/banner.dto';

@ApiTags('Storefront — Content')
@Controller('storefront/content')
export class StorefrontContentController {
  constructor(private readonly service: ContentService) {}

  @Get('banners/:slot')
  async banners(@Param('slot') slot: string, @Query('scopeId') scopeId?: string) {
    const data = await this.service.listBannersForSlot(slot.toUpperCase() as BannerSlot, scopeId);
    return { success: true, message: 'Banners', data };
  }

  /**
   * Phase 49 (2026-05-21) — public read filters published+non-deleted
   * at the service layer (was unfiltered before; drafts were
   * publicly readable via direct URL).
   */
  @Get('pages/:slug')
  async page(@Param('slug') slug: string) {
    const data = await this.service.getPageBySlug(slug);
    return { success: true, message: 'Page', data };
  }

  @Get('faq')
  async faq(@Query('category') category?: string) {
    const data = await this.service.listFaq(category);
    return { success: true, message: 'FAQ', data };
  }
}

/**
 * Phase 49 (2026-05-21) — legacy banner + FAQ admin controller. The
 * static-page routes have moved to AdminStaticPagesController (cleaner
 * separation + explicit POST/PATCH split). FAQ routes are kept here
 * for now (the audit's recommended split into AdminFaqController is
 * deferred; it would be churn without behavioural change since RBAC +
 * audit + actor tracking are already in place at the service layer).
 */
@ApiTags('Admin — Content')
@Controller('admin/content')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminContentController {
  constructor(private readonly service: ContentService) {}

  @Get('banners')
  @Permissions('content.read')
  async banners() {
    return { success: true, data: await this.service.listAllBanners() };
  }

  @Post('banners')
  @Permissions('content.write')
  async createBanner(@Body() body: CreateBannerDto) {
    return { success: true, data: await this.service.createBanner(body) };
  }

  @Patch('banners/:id')
  @Permissions('content.write')
  async updateBanner(@Param('id') id: string, @Body() body: UpdateBannerDto) {
    return { success: true, data: await this.service.updateBanner(id, body) };
  }

  @Delete('banners/:id')
  @Permissions('content.write')
  async deleteBanner(@Param('id') id: string) {
    await this.service.deleteBanner(id);
    return { success: true };
  }

  // ── FAQ (admin) ───────────────────────────────────────────────

  @Get('faq')
  @Permissions('content.read')
  async listFaq() {
    return { success: true, data: await this.service.listAllFaq() };
  }

  @Post('faq')
  @Permissions('content.write')
  async createFaq(@Body() body: CreateFaqDto, @Req() req: Request) {
    const actorId = (req as any).adminId as string | undefined;
    return { success: true, data: await this.service.createFaq(body, actorId) };
  }

  @Patch('faq/:id')
  @Permissions('content.write')
  async updateFaq(
    @Param('id') id: string,
    @Body() body: UpdateFaqDto,
    @Req() req: Request,
  ) {
    const actorId = (req as any).adminId as string | undefined;
    return { success: true, data: await this.service.updateFaq(id, body, actorId) };
  }

  @Delete('faq/:id')
  @Permissions('content.write')
  async deleteFaq(@Param('id') id: string, @Req() req: Request) {
    const actorId = (req as any).adminId as string | undefined;
    await this.service.deleteFaq(id, actorId);
    return { success: true };
  }

  @Post('faq/:id/restore')
  @Permissions('content.write')
  async restoreFaq(@Param('id') id: string, @Req() req: Request) {
    const actorId = (req as any).adminId as string | undefined;
    return { success: true, data: await this.service.restoreFaq(id, actorId) };
  }
}
