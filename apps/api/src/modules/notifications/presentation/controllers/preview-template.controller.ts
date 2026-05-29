import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { NotificationChannel } from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { TemplateRegistry } from '../../application/services/template-registry.service';
import { TemplateRenderer } from '../../application/services/template-renderer.service';

interface UpsertTemplateDto {
  channel: NotificationChannel;
  subject?: string;
  body: string;
  description?: string;
  active?: boolean;
}

@ApiTags('Admin Notifications')
@Controller('admin/notifications/templates')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('notifications.write')
export class AdminNotificationTemplatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: TemplateRegistry,
    private readonly renderer: TemplateRenderer,
  ) {}

  @Get()
  async list(
    @Query('channel') channel?: string,
    @Query('active') active?: string,
    @Query('search') search?: string,
  ) {
    const where: any = {};
    if (channel) where.channel = channel.toUpperCase();
    if (active === 'true') where.active = true;
    if (active === 'false') where.active = false;
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { key: { contains: q, mode: 'insensitive' } },
        { subject: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
    const items = await this.prisma.notificationTemplate.findMany({
      where,
      orderBy: { key: 'asc' },
    });
    return { success: true, message: 'Templates retrieved', data: { items } };
  }

  @Get(':key')
  async getByKey(@Param('key') key: string) {
    // Fall back to the resolved template (DB or code-side default) so the
    // admin UI can edit a default before any DB row exists.
    const fromDb = await this.prisma.notificationTemplate.findUnique({
      where: { key },
    });
    if (fromDb) {
      return { success: true, message: 'Template retrieved', data: fromDb };
    }
    const resolved = await this.registry.get(key);
    if (!resolved) throw new NotFoundAppException(`No template "${key}"`);
    return {
      success: true,
      message: 'Template retrieved (default — not yet saved to DB)',
      data: { ...resolved, fromDefault: true },
    };
  }

  /**
   * Upsert a template by key. Used by the admin UI as the single
   * "save" action — works for first save (insert) and edits (update).
   */
  @Put(':key')
  async upsert(@Param('key') key: string, @Body() body: UpsertTemplateDto) {
    if (!body?.channel) {
      throw new BadRequestAppException('channel is required');
    }
    if (!body?.body?.trim()) {
      throw new BadRequestAppException('body is required');
    }
    const data = await this.prisma.notificationTemplate.upsert({
      where: { key },
      create: {
        key,
        channel: body.channel,
        subject: body.subject?.trim() || null,
        body: body.body,
        description: body.description?.trim() || null,
        active: body.active ?? true,
      },
      update: {
        channel: body.channel,
        subject: body.subject?.trim() || null,
        body: body.body,
        description: body.description?.trim() || null,
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });
    return { success: true, message: 'Template saved', data };
  }

  @Patch(':key/active')
  async toggleActive(
    @Param('key') key: string,
    @Body() body: { active: boolean },
  ) {
    if (typeof body?.active !== 'boolean') {
      throw new BadRequestAppException('active is required');
    }
    const data = await this.prisma.notificationTemplate.update({
      where: { key },
      data: { active: body.active },
    });
    return { success: true, message: 'Template updated', data };
  }

  /**
   * Render a template's subject + body against admin-supplied vars.
   * Read-only — does not enqueue or send. Used by the editor preview pane.
   */
  @Post(':key/preview')
  async preview(
    @Param('key') key: string,
    @Body() body: { vars?: Record<string, unknown> },
  ) {
    const tpl = await this.registry.get(key);
    if (!tpl) throw new NotFoundAppException(`No template "${key}"`);
    const vars = body?.vars ?? {};
    return {
      success: true,
      message: 'Preview rendered',
      data: {
        channel: tpl.channel,
        subject: tpl.subject ? this.renderer.render(tpl.subject, vars) : null,
        body: this.renderer.render(tpl.body, vars),
      },
    };
  }
}
