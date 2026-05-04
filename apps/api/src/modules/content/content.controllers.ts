import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { BannerSlot } from '@prisma/client';
import { AdminAuthGuard } from '../../core/guards';
import { ContentService } from './content.service';

@ApiTags('Storefront — Content')
@Controller('storefront/content')
export class StorefrontContentController {
  constructor(private readonly service: ContentService) {}

  @Get('banners/:slot')
  async banners(@Param('slot') slot: string, @Query('scopeId') scopeId?: string) {
    const data = await this.service.listBannersForSlot(slot.toUpperCase() as BannerSlot, scopeId);
    return { success: true, message: 'Banners', data };
  }

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

@ApiTags('Admin — Content')
@Controller('admin/content')
@UseGuards(AdminAuthGuard)
export class AdminContentController {
  constructor(private readonly service: ContentService) {}

  @Get('banners')
  async banners() {
    return { success: true, data: await this.service.listAllBanners() };
  }

  @Post('banners')
  async createBanner(@Body() body: any) {
    return { success: true, data: await this.service.createBanner(body) };
  }

  @Patch('banners/:id')
  async updateBanner(@Param('id') id: string, @Body() body: any) {
    return { success: true, data: await this.service.updateBanner(id, body) };
  }

  @Delete('banners/:id')
  async deleteBanner(@Param('id') id: string) {
    await this.service.deleteBanner(id);
    return { success: true };
  }

  @Get('pages')
  async pages() {
    return { success: true, data: await this.service.listPages() };
  }

  @Put('pages/:slug')
  async upsertPage(@Param('slug') slug: string, @Body() body: any) {
    return { success: true, data: await this.service.upsertPage(slug, body) };
  }

  @Delete('pages/:slug')
  async deletePage(@Param('slug') slug: string) {
    await this.service.deletePage(slug);
    return { success: true };
  }

  @Get('faq')
  async faq() {
    return { success: true, data: await this.service.listFaq() };
  }

  @Post('faq')
  async createFaq(@Body() body: any) {
    return { success: true, data: await this.service.createFaq(body) };
  }

  @Patch('faq/:id')
  async updateFaq(@Param('id') id: string, @Body() body: any) {
    return { success: true, data: await this.service.updateFaq(id, body) };
  }

  @Delete('faq/:id')
  async deleteFaq(@Param('id') id: string) {
    await this.service.deleteFaq(id);
    return { success: true };
  }
}
