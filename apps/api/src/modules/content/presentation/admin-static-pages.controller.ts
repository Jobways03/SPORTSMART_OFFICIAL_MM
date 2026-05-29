import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../core/guards';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../core/decorators/idempotent.decorator';
import { ContentService } from '../content.service';
import { ContentPageAuditService } from '../services/content-page-audit.service';
import {
  CreateStaticPageDto,
  UpdateStaticPageDto,
} from '../dtos/static-page.dto';

/**
 * Phase 49 (2026-05-21) — dedicated static-page admin controller.
 *
 * Pre-Phase-49 the static-page routes were lumped into the broader
 * AdminContentController (banner + FAQ + page). This caused the
 * audit-flagged Gap #7: PUT /pages/:slug was an upsert, so a typo
 * in the URL silently created a new draft page. The split puts the
 * static-page write surface behind explicit POST (create) + PATCH
 * (update) endpoints; the legacy PUT upsert is preserved for
 * back-compat with existing admin UIs but routes through the same
 * audited service.
 *
 * Permission model (already in registry):
 *   content.read   — admin can list / view pages
 *   content.write  — admin can create / edit / delete
 *   content.publish — admin can flip published state
 */
@ApiTags('Admin — Static Pages')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/content/pages')
export class AdminStaticPagesController {
  constructor(
    private readonly service: ContentService,
    private readonly audit: ContentPageAuditService,
  ) {}

  @Get()
  @Permissions('content.read')
  async list() {
    return { success: true, data: await this.service.listPages() };
  }

  @Get('archive')
  @Permissions('content.read')
  async listArchive() {
    return { success: true, data: await this.service.listAllPagesIncludingDeleted() };
  }

  @Get(':slug')
  @Permissions('content.read')
  async get(@Param('slug') slug: string) {
    return { success: true, data: await this.service.getPageBySlugAdmin(slug) };
  }

  @Post()
  @Permissions('content.write')
  @Idempotent()
  async create(@Body() dto: CreateStaticPageDto, @Req() req: Request) {
    const actorId = (req as any).adminId as string | undefined;
    const row = await this.service.createPage(dto, actorId);
    return { success: true, data: row, message: 'Page created' };
  }

  @Patch(':slug')
  @Permissions('content.write')
  async update(
    @Param('slug') slug: string,
    @Body() dto: UpdateStaticPageDto,
    @Req() req: Request,
  ) {
    const actorId = (req as any).adminId as string | undefined;
    const row = await this.service.updatePage(slug, dto, actorId);
    return { success: true, data: row, message: 'Page updated' };
  }

  /**
   * Legacy upsert preserved for back-compat with existing admin
   * frontends. New code should use POST (create) or PATCH (update).
   * The service guards against the create-on-typo trap by routing
   * to updatePage if the slug exists, createPage otherwise — both
   * paths run the same sanitization + audit pipeline.
   */
  @Put(':slug')
  @Permissions('content.write')
  async upsert(
    @Param('slug') slug: string,
    @Body() dto: CreateStaticPageDto,
    @Req() req: Request,
  ) {
    const actorId = (req as any).adminId as string | undefined;
    const row = await this.service.upsertPage(slug, dto, actorId);
    return { success: true, data: row };
  }

  @Post(':slug/publish')
  @Permissions('content.publish')
  async publish(@Param('slug') slug: string, @Req() req: Request) {
    const actorId = (req as any).adminId as string | undefined;
    const row = await this.service.publishPage(slug, actorId);
    return { success: true, data: row, message: 'Page published' };
  }

  @Post(':slug/unpublish')
  @Permissions('content.publish')
  async unpublish(@Param('slug') slug: string, @Req() req: Request) {
    const actorId = (req as any).adminId as string | undefined;
    const row = await this.service.unpublishPage(slug, actorId);
    return { success: true, data: row, message: 'Page unpublished' };
  }

  @Delete(':slug')
  @Permissions('content.write')
  @HttpCode(204)
  async remove(@Param('slug') slug: string, @Req() req: Request) {
    const actorId = (req as any).adminId as string | undefined;
    await this.service.deletePage(slug, actorId);
  }

  @Post(':slug/restore')
  @Permissions('content.write')
  async restore(@Param('slug') slug: string, @Req() req: Request) {
    const actorId = (req as any).adminId as string | undefined;
    const row = await this.service.restorePage(slug, actorId);
    return { success: true, data: row, message: 'Page restored' };
  }

  @Get(':slug/history')
  @Permissions('content.read')
  async history(
    @Param('slug') slug: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const entries = await this.audit.list('PAGE', slug, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { success: true, data: entries };
  }
}
