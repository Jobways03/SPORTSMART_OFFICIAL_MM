import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import { NotificationLogRepository } from '../../infrastructure/persistence/prisma/notification-log.repository';
import { NotificationsPublicFacade } from '../../application/facades/notifications-public.facade';
import { NotificationGateService } from '../../application/services/notification-gate.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { RetryLogDto } from '../dtos/logs.dtos';

const UNMASK_PERMISSION = 'notifications.logs.read.unmasked';

function adminActorId(req: any): string {
  const id = req?.adminId ?? req?.user?.id;
  if (!id) throw new UnauthorizedAppException('Admin identity not resolved');
  return id;
}

function hasUnmask(req: any): boolean {
  const perms: string[] = req?.user?.permissions ?? [];
  return perms.includes(UNMASK_PERMISSION);
}

function maskEmail(e: string): string {
  const [u, d] = e.split('@');
  if (!d || !u) return '***';
  return `${u[0]}${'*'.repeat(Math.max(1, u.length - 2))}${u.length > 1 ? u.slice(-1) : ''}@${d}`;
}
function maskPhone(p: string): string {
  const digits = p.replace(/\s/g, '');
  return digits.length > 4 ? `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}` : '****';
}
function maskDestination(channel: string, dest: string): string {
  if (!dest) return dest;
  return channel === 'EMAIL' && dest.includes('@') ? maskEmail(dest) : maskPhone(dest);
}

@ApiTags('Admin Notifications')
@Controller('admin/notifications/logs')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class AdminNotificationLogsController {
  constructor(
    private readonly logs: NotificationLogRepository,
    private readonly notifications: NotificationsPublicFacade,
    // Phase 190 (#11) — opt-out check on retry.
    private readonly gate: NotificationGateService,
    // Phase 190 (#12) — audit retry + unmasked views.
    private readonly audit: AuditPublicFacade,
  ) {}

  @Get()
  // Phase 190 (#1) — dedicated read permission (was the broad notifications.read).
  @Permissions('notifications.logs.read')
  async list(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
    @Query('recipientId') recipientId?: string,
    @Query('eventType') eventType?: string,
    @Query('search') search?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const data = await this.logs.listForAdmin({
      page: parseInt(page || '1', 10) || 1,
      limit: Math.min(parseInt(limit || '50', 10) || 50, 200),
      // #13 — validate the enum query params instead of an unsafe cast.
      channel: this.parseChannel(channel),
      status: this.parseStatus(status),
      recipientId: recipientId?.trim() || undefined,
      eventType: eventType?.trim() || undefined,
      search: search?.trim() || undefined,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
    });
    // #9 — mask PII unless the caller holds the unmask permission.
    const unmasked = hasUnmask(req);
    return {
      success: true,
      message: 'Logs retrieved',
      data: { ...data, items: (data as any).items.map((l: any) => this.shape(l, unmasked)) },
    };
  }

  @Get(':id')
  @Permissions('notifications.logs.read')
  async getOne(@Req() req: any, @Param('id') id: string) {
    const log = await this.logs.findById(id);
    if (!log) throw new NotFoundAppException('Log not found');
    return { success: true, message: 'Log retrieved', data: this.shape(log, hasUnmask(req)) };
  }

  /**
   * Re-enqueue a notification. Phase 190:
   *  - #1 dedicated notifications.logs.retry (HIGH) permission
   *  - #11 respects opt-out; an opted-out recipient needs a bypassReason
   *  - #3 forceTemplateReRender re-renders from the CURRENT template
   *  - #12 audit-logged; #4 the new log row links to this one via parentLogId
   */
  @Post(':id/retry')
  @Permissions('notifications.logs.retry')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async retry(@Req() req: any, @Param('id') id: string, @Body() dto: RetryLogDto) {
    const actor = adminActorId(req);
    const log = await this.logs.findById(id);
    if (!log) throw new NotFoundAppException('Log not found');

    const destination = log.recipientId ? null : log.destination;

    // #11 — opt-out check (suppression + preference). Only override with a reason.
    if (log.recipientId) {
      const decision = await this.gate.check({
        channel: log.channel,
        destination: log.destination,
        recipientUserId: log.recipientId,
        eventClass: log.eventType ?? 'order',
      });
      if (!decision.allowed && !dto.bypassReason?.trim()) {
        throw new ForbiddenAppException(
          `Recipient is opted out / suppressed (${decision.reason}). ` +
            `Provide a bypassReason to override (audited), or use the raw-dispatch endpoint.`,
        );
      }
    }

    let jobId: string;
    let mode: 'FROZEN' | 'RE_RENDERED';
    // #3 — re-render from the current template when asked + possible.
    if (dto.forceTemplateReRender && log.templateKey && log.recipientId) {
      mode = 'RE_RENDERED';
      jobId = await this.notifications.notifyFromTemplate({
        eventClass: log.eventType ?? 'order',
        templateKey: log.templateKey,
        recipientId: log.recipientId,
        vars: dto.vars ?? {},
        eventId: id,
        triggerSource: 'ADMIN_RETRY',
      });
    } else {
      mode = 'FROZEN';
      jobId = await this.notifications.notify({
        channel: log.channel,
        recipientId: log.recipientId ?? undefined,
        to: destination ?? undefined,
        templateKey: log.templateKey ?? undefined,
        subject: log.subject ?? undefined,
        body: log.body,
        eventType: log.eventType ?? 'admin.retry',
        eventId: id,
        triggerSource: 'ADMIN_RETRY',
        parentLogId: id,
      });
    }

    await this.audit.writeAuditLog({
      actorId: actor,
      action: 'notifications.log.retried',
      module: 'notifications',
      resource: 'NotificationLog',
      resourceId: id,
      newValue: { mode, bypassReason: dto.bypassReason ?? null, jobId },
    });

    return {
      success: true,
      message: mode === 'RE_RENDERED' ? 'Re-rendered + re-enqueued' : 'Re-enqueued (frozen content)',
      data: { jobId, mode },
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private parseChannel(raw?: string): NotificationChannel | undefined {
    if (!raw) return undefined;
    const up = raw.toUpperCase();
    if (!(up in NotificationChannel)) {
      throw new BadRequestAppException(`Invalid channel "${raw}"`);
    }
    return up as NotificationChannel;
  }

  private parseStatus(raw?: string): NotificationStatus | undefined {
    if (!raw) return undefined;
    const up = raw.toUpperCase();
    if (!(up in NotificationStatus)) {
      throw new BadRequestAppException(`Invalid status "${raw}"`);
    }
    return up as NotificationStatus;
  }

  /** #9 — mask destination + body for the default (masked) view. */
  private shape(log: any, unmasked: boolean) {
    if (unmasked) return log;
    return {
      ...log,
      destination: maskDestination(log.channel, log.destination),
      // Body can carry OTPs/links → only a short preview when masked.
      body: typeof log.body === 'string' && log.body.length > 140 ? `${log.body.slice(0, 140)}…` : log.body,
      failureReason: log.failureReason ? '(masked — needs unmask permission)' : null,
      masked: true,
    };
  }
}
