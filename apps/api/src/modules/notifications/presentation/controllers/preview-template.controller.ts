import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { NotificationChannel } from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import {
  BadRequestAppException,
  NotFoundAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { sanitizeEmailTemplateBody } from '../../../../core/utils/rich-text-sanitizer';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { TemplateRegistry } from '../../application/services/template-registry.service';
import { TemplateRenderer } from '../../application/services/template-renderer.service';
import { NotificationsPublicFacade } from '../../application/facades/notifications-public.facade';
import {
  PreviewTemplateDto,
  TestSendDto,
  ToggleActiveDto,
  UpsertTemplateDto,
} from '../dtos/template.dtos';

/** Map a template-key channel suffix → the channel it must declare (#7). */
const KEY_SUFFIX_CHANNEL: Record<string, NotificationChannel> = {
  email: 'EMAIL',
  sms: 'SMS',
  whatsapp: 'WHATSAPP',
};

function adminActorId(req: any): string {
  const id = req?.adminId ?? req?.user?.id;
  if (!id) throw new UnauthorizedAppException('Admin identity not resolved');
  return id;
}

@ApiTags('Admin Notifications')
@Controller('admin/notifications/templates')
@UseGuards(AdminAuthGuard, PermissionsGuard)
// Phase 185 (#10) — throttle every template mutation/read; a compromised
// token can't churn hundreds of edits per second.
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminNotificationTemplatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: TemplateRegistry,
    private readonly renderer: TemplateRenderer,
    // Phase 185 (#11) — audit template edits.
    private readonly audit: AuditPublicFacade,
    // Phase 185 (#16) — real test-send.
    private readonly notifications: NotificationsPublicFacade,
  ) {}

  @Get()
  // Phase 185 (#2) — reads need only the LOW-risk read permission.
  @Permissions('notifications.read')
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
  @Permissions('notifications.read')
  async getByKey(@Param('key') key: string) {
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
   * Upsert a template by key. Single "save" action — first save (insert)
   * and edits (update). Mutations require the HIGH-risk write permission.
   */
  @Put(':key')
  @Permissions('notifications.write')
  async upsert(
    @Req() req: any,
    @Param('key') key: string,
    @Body() body: UpsertTemplateDto,
  ) {
    // #7 — reject a key whose channel suffix contradicts the declared channel.
    this.assertKeyChannelConsistent(key, body.channel);

    // #10 — EMAIL templates require a subject (a null subject is rejected /
    // defaulted to "(no subject)" by providers).
    if (body.channel === 'EMAIL' && !body.subject?.trim()) {
      throw new BadRequestAppException('subject is required for EMAIL templates');
    }

    // #1 — reject Handlebars constructs the renderer doesn't support, so an
    // admin can't save a template that would silently render as literal text.
    const syntaxIssues = [
      ...this.renderer.validateSyntax(body.body),
      ...(body.subject ? this.renderer.validateSyntax(body.subject) : []),
    ];
    if (syntaxIssues.length > 0) {
      throw new BadRequestAppException(
        `Unsupported template syntax — ${syntaxIssues.join(' ')}`,
      );
    }

    // #3 — sanitize admin-authored EMAIL HTML.
    const cleanBody =
      body.channel === 'EMAIL' ? sanitizeEmailTemplateBody(body.body) : body.body;
    const actor = adminActorId(req);

    const before = await this.prisma.notificationTemplate.findUnique({ where: { key } });
    const nextVersion = (before?.version ?? 0) + 1;

    // #4/#6 — version + history snapshot written atomically with the edit.
    const data = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.notificationTemplate.upsert({
        where: { key },
        create: {
          key,
          channel: body.channel,
          subject: body.subject?.trim() || null,
          body: cleanBody,
          description: body.description?.trim() || null,
          active: body.active ?? true,
          dltTemplateId: body.dltTemplateId?.trim() || null,
          dltHeaderId: body.dltHeaderId?.trim() || null,
          variablesSchema:
            body.variablesSchema !== undefined
              ? (body.variablesSchema as Prisma.InputJsonValue)
              : undefined,
          customerVisibleOnly: body.customerVisibleOnly ?? true,
          version: 1,
          createdByAdminId: actor,
          updatedByAdminId: actor,
        },
        update: {
          channel: body.channel,
          subject: body.subject?.trim() || null,
          body: cleanBody,
          description: body.description?.trim() || null,
          ...(body.active !== undefined ? { active: body.active } : {}),
          dltTemplateId: body.dltTemplateId?.trim() || null,
          dltHeaderId: body.dltHeaderId?.trim() || null,
          ...(body.variablesSchema !== undefined
            ? { variablesSchema: body.variablesSchema as Prisma.InputJsonValue }
            : {}),
          ...(body.customerVisibleOnly !== undefined
            ? { customerVisibleOnly: body.customerVisibleOnly }
            : {}),
          version: nextVersion,
          updatedByAdminId: actor,
        },
      });
      // One history row per version = full post-change snapshot.
      await tx.notificationTemplateHistory.create({
        data: {
          templateId: saved.id,
          templateKey: key,
          version: saved.version,
          channel: saved.channel,
          subject: saved.subject,
          body: saved.body,
          active: saved.active,
          changeType: before ? 'UPDATE' : 'CREATE',
          changedByAdminId: actor,
        },
      });
      return saved;
    });

    await this.audit.writeAuditLog({
      actorId: actor,
      action: before ? 'notifications.template.updated' : 'notifications.template.created',
      module: 'notifications',
      resource: 'NotificationTemplate',
      resourceId: key,
      oldValue: before
        ? { version: before.version, subject: before.subject, body: before.body, active: before.active, channel: before.channel }
        : null,
      newValue: { version: data.version, subject: data.subject, body: data.body, active: data.active, channel: data.channel },
    });

    return { success: true, message: 'Template saved', data };
  }

  @Patch(':key/active')
  @Permissions('notifications.write')
  async toggleActive(
    @Req() req: any,
    @Param('key') key: string,
    @Body() body: ToggleActiveDto,
  ) {
    const before = await this.prisma.notificationTemplate.findUnique({ where: { key } });
    if (!before) throw new NotFoundAppException(`No template "${key}"`);
    const actor = adminActorId(req);

    const data = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.notificationTemplate.update({
        where: { key },
        data: { active: body.active, version: before.version + 1, updatedByAdminId: actor },
      });
      await tx.notificationTemplateHistory.create({
        data: {
          templateId: saved.id,
          templateKey: key,
          version: saved.version,
          channel: saved.channel,
          subject: saved.subject,
          body: saved.body,
          active: saved.active,
          changeType: 'TOGGLE',
          changedByAdminId: actor,
        },
      });
      return saved;
    });

    await this.audit.writeAuditLog({
      actorId: actor,
      action: 'notifications.template.toggled',
      module: 'notifications',
      resource: 'NotificationTemplate',
      resourceId: key,
      oldValue: { active: before.active },
      newValue: { active: data.active, version: data.version },
    });
    return { success: true, message: 'Template updated', data };
  }

  /**
   * Phase 188 (#4) — version history for a template (newest first). Lets an
   * auditor see what a template looked like at any past version.
   */
  @Get(':key/history')
  @Permissions('notifications.read')
  async history(@Param('key') key: string) {
    const items = await this.prisma.notificationTemplateHistory.findMany({
      where: { templateKey: key },
      orderBy: { version: 'desc' },
      take: 100,
    });
    return { success: true, message: 'Template history', data: { items } };
  }

  /**
   * Render a template's subject + body against admin-supplied vars.
   * Read-only — does not enqueue or send. The renderer HTML-escapes every
   * substituted value (#15), so the returned strings are safe to display
   * as text; the editor preview pane should still render inside a sandbox.
   */
  @Post(':key/preview')
  @Permissions('notifications.read')
  async preview(
    @Param('key') key: string,
    @Body() body: PreviewTemplateDto,
  ) {
    const tpl = await this.registry.get(key);
    if (!tpl) throw new NotFoundAppException(`No template "${key}"`);
    const vars = body?.vars ?? {};

    // #12 — bound the preview payload (the DTO @IsObject's it; cap size here).
    if (Object.keys(vars).length > 50) {
      throw new BadRequestAppException('preview vars may not exceed 50 keys');
    }
    if (JSON.stringify(vars).length > 100_000) {
      throw new BadRequestAppException('preview vars payload too large (>100KB)');
    }

    const subjectText = tpl.subject
      ? this.renderer.render(tpl.subject, vars, { channel: tpl.channel })
      : null;
    const bodyText = this.renderer.render(tpl.body, vars, { channel: tpl.channel });

    // #16 — surface which referenced vars the sample payload didn't fill,
    // plus any declared-required vars that are missing.
    const referenced = [
      ...this.renderer.referencedVars(tpl.body),
      ...(tpl.subject ? this.renderer.referencedVars(tpl.subject) : []),
    ];
    const missingVars = [...new Set(referenced)].filter(
      (p) => this.renderer.resolve(vars, p) == null,
    );
    const missingRequired = this.renderer.findMissingRequiredVars(tpl.variablesSchema, vars);

    // #1 — preview-time syntax warnings (non-blocking here; blocked at save).
    const syntaxWarnings = [
      ...this.renderer.validateSyntax(tpl.body),
      ...(tpl.subject ? this.renderer.validateSyntax(tpl.subject) : []),
    ];

    // #15 — flag raw {{{...}}} so the UI renders the preview in a sandbox.
    const containsRawHtml = /\{\{\{\s*[\w.]+\s*\}\}\}/.test(tpl.body);

    return {
      success: true,
      message: 'Preview rendered',
      data: {
        channel: tpl.channel,
        subject: subjectText,
        body: bodyText,
        missingVars,
        missingRequiredVars: missingRequired,
        warnings: syntaxWarnings,
        containsRawHtml,
        // #14 — channel-specific length/cost hints for the editor.
        channelHints: this.channelHints(tpl.channel, subjectText, bodyText),
      },
    };
  }

  /**
   * Phase 185 (#16) — send a real test notification of this template to an
   * admin-supplied destination so editors can verify real-world rendering.
   * Tightly rate-limited (5/min) and write-gated.
   */
  @Post(':key/test-send')
  @Permissions('notifications.write')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async testSend(
    @Req() req: any,
    @Param('key') key: string,
    @Body() body: TestSendDto,
  ) {
    const tpl = await this.registry.get(key);
    if (!tpl) throw new NotFoundAppException(`No template "${key}"`);
    const vars = body.vars ?? {};
    const subject = tpl.subject
      ? this.renderer.render(tpl.subject, vars, { channel: tpl.channel })
      : undefined;
    const renderedBody = this.renderer.render(tpl.body, vars, { channel: tpl.channel });

    const jobId = await this.notifications.notify({
      channel: tpl.channel,
      to: body.to,
      templateKey: key,
      subject,
      body: renderedBody,
      eventType: 'admin.test_send',
      triggerSource: 'TEST_SEND',
      dltTemplateId: tpl.dltTemplateId ?? null,
      dltHeaderId: tpl.dltHeaderId ?? null,
    });

    await this.audit.writeAuditLog({
      actorId: adminActorId(req),
      action: 'notifications.template.test_sent',
      module: 'notifications',
      resource: 'NotificationTemplate',
      resourceId: key,
      newValue: { to: body.to, channel: tpl.channel },
    });

    return {
      success: true,
      message: 'Test notification enqueued',
      data: { jobId, channel: tpl.channel },
    };
  }

  /**
   * Phase 188 (#14) — channel-specific length / cost hints for the editor.
   * SMS: GSM-7 packs 160 chars/segment (153 in multipart); any non-GSM char
   * forces UCS-2 at 70/segment (67 multipart). WhatsApp free-form is limited
   * to the 24h window + needs an approved HSM template outside it.
   */
  private channelHints(
    channel: NotificationChannel,
    subject: string | null,
    body: string,
  ): Record<string, unknown> {
    if (channel === 'SMS') {
      // eslint-disable-next-line no-control-regex
      const isUnicode = /[^\x00-\x7F]/.test(body);
      const per = isUnicode ? 70 : 160;
      const perMulti = isUnicode ? 67 : 153;
      const len = body.length;
      const segments = len <= per ? 1 : Math.ceil(len / perMulti);
      return {
        encoding: isUnicode ? 'UCS-2' : 'GSM-7',
        length: len,
        segments,
        note:
          segments > 1
            ? `This message spans ${segments} SMS segments (billed per segment).`
            : 'Fits in a single SMS segment.',
      };
    }
    if (channel === 'WHATSAPP') {
      return {
        length: body.length,
        note:
          'Outside the 24h customer-service window, WhatsApp requires a Meta-approved ' +
          'HSM template (prefix the key with the configured template prefix).',
      };
    }
    return { subjectLength: subject?.length ?? 0, bodyLength: body.length };
  }

  // #7 — key/channel consistency. Only enforced when the key carries a
  // recognised channel suffix; keys without one (rare) are left alone.
  private assertKeyChannelConsistent(key: string, channel: NotificationChannel) {
    const suffix = key.split('.').pop()?.toLowerCase() ?? '';
    const expected = KEY_SUFFIX_CHANNEL[suffix];
    if (expected && expected !== channel) {
      throw new BadRequestAppException(
        `Template key "${key}" ends in ".${suffix}" but channel is ${channel}; ` +
          `the channel suffix must match the channel (expected ${expected}).`,
      );
    }
  }
}
