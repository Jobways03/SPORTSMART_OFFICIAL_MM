import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import { AdminDispatchService } from '../../application/services/admin-dispatch.service';
import {
  DispatchDto,
  RawDispatchDto,
  TemplateDispatchDto,
} from '../dtos/template.dtos';

function adminActorId(req: any): string {
  const id = req?.adminId ?? req?.user?.id;
  if (!id) throw new UnauthorizedAppException('Admin identity not resolved');
  return id;
}

/**
 * Manual one-off dispatch — the escape hatch for ops.
 *
 * Phase 187 — split into two permission-tiered endpoints:
 *   POST /admin/notifications/dispatch/template  (notifications.dispatch.template, MEDIUM)
 *       — respects customer opt-out; requires a registered eventClass.
 *   POST /admin/notifications/dispatch/raw       (notifications.dispatch.raw, CRITICAL)
 *       — bypasses opt-out; requires alertType + bypassReason + confirmation.
 *
 * The legacy POST /admin/notifications/dispatch is kept for the template
 * path only (raw is rejected with a pointer to /dispatch/raw, so it can't
 * be used to bypass the elevated raw permission). Every dispatch captures
 * the acting admin (#3), is idempotent (#8/#9), throttled (#6) and audited.
 */
@ApiTags('Admin Notifications')
@Controller('admin/notifications')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminNotificationDispatchController {
  constructor(private readonly dispatch: AdminDispatchService) {}

  @Post('dispatch/template')
  @Permissions('notifications.dispatch.template')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Idempotent()
  async dispatchTemplate(@Req() req: any, @Body() body: TemplateDispatchDto) {
    const result = await this.dispatch.dispatchTemplate({
      adminId: adminActorId(req),
      templateKey: body.templateKey,
      recipientId: body.recipientId,
      vars: body.vars,
      eventClass: body.eventClass,
      idempotencyKey: body.idempotencyKey,
    });
    return this.toResponse(result);
  }

  @Post('dispatch/raw')
  @Permissions('notifications.dispatch.raw')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Idempotent()
  async dispatchRaw(@Req() req: any, @Body() body: RawDispatchDto) {
    const result = await this.dispatch.dispatchRaw({
      adminId: adminActorId(req),
      channel: body.channel,
      recipientId: body.recipientId,
      to: body.to,
      subject: body.subject,
      body: body.body,
      alertType: body.alertType,
      bypassReason: body.bypassReason,
      confirmed: body.confirmed,
      idempotencyKey: body.idempotencyKey,
    });
    return this.toResponse(result);
  }

  /**
   * Legacy combined endpoint. Template path only — a raw body is rejected
   * with a pointer to the elevated /dispatch/raw endpoint so this route can
   * never be used to send an opt-out-bypassing message at the lower tier.
   */
  @Post('dispatch')
  @Permissions('notifications.dispatch')
  async legacyDispatch(@Req() req: any, @Body() body: DispatchDto) {
    if (!body.templateKey) {
      throw new BadRequestAppException(
        'Raw dispatch must use POST /admin/notifications/dispatch/raw ' +
          '(it requires alertType + bypassReason + confirmation).',
      );
    }
    if (!body.recipientId) {
      throw new BadRequestAppException('recipientId is required for a template dispatch');
    }
    const result = await this.dispatch.dispatchTemplate({
      adminId: adminActorId(req),
      templateKey: body.templateKey,
      recipientId: body.recipientId,
      vars: body.vars,
      eventClass: body.eventClass,
    });
    return this.toResponse(result);
  }

  private toResponse(result: {
    jobId: string | null;
    eventId: string;
    status: string;
    deduped: boolean;
    message: string;
  }) {
    return {
      success: result.status === 'ENQUEUED',
      message: result.message,
      data: {
        jobId: result.jobId,
        eventId: result.eventId,
        status: result.status,
        deduped: result.deduped,
      },
    };
  }
}
