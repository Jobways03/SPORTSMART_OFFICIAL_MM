import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { BadRequestAppException, NotFoundAppException } from '../../../../core/exceptions';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { NotificationsPublicFacade } from '../../application/facades/notifications-public.facade';

/**
 * Phase 185 (#12) — DLQ + queue observability surface.
 *
 * Before this controller, jobs that exhausted their retries went into a
 * Redis dead-letter list with no way to view or replay them — a silent
 * notification was lost forever. This exposes:
 *   • GET  /admin/notifications/dlq            — list dead-lettered jobs
 *   • POST /admin/notifications/dlq/:index/replay — re-enqueue one
 *   • DELETE /admin/notifications/dlq/:index   — discard one
 *   • GET  /admin/notifications/queue/stats    — depth (ready/delayed/dlq)
 *
 * Gated by the dedicated HIGH-risk `notifications.dlq.manage` permission.
 */
@ApiTags('Admin Notifications')
@Controller('admin/notifications')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('notifications.dlq.manage')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminNotificationDlqController {
  constructor(
    private readonly notifications: NotificationsPublicFacade,
    private readonly audit: AuditPublicFacade,
  ) {}

  @Get('queue/stats')
  async stats() {
    const stats = await this.notifications.getQueueStats();
    return { success: true, message: 'Queue stats', data: stats };
  }

  @Get('dlq')
  async list(@Query('offset') offset?: string, @Query('limit') limit?: string) {
    const off = Math.max(0, Number.parseInt(offset ?? '0', 10) || 0);
    const lim = Math.min(100, Math.max(1, Number.parseInt(limit ?? '50', 10) || 50));
    const result = await this.notifications.listDeadLetters(off, lim);
    return { success: true, message: 'Dead-letter queue', data: result };
  }

  @Post('dlq/:index/replay')
  async replay(@Req() req: any, @Param('index') index: string) {
    const idx = this.parseIndex(index);
    const jobId = await this.notifications.replayDeadLetter(idx);
    if (!jobId) {
      throw new NotFoundAppException(`No dead-letter at index ${idx}`);
    }
    await this.audit.writeAuditLog({
      actorId: req?.adminId ?? req?.user?.id,
      action: 'notifications.dlq.replayed',
      module: 'notifications',
      resource: 'NotificationDeadLetter',
      resourceId: String(idx),
      newValue: { jobId },
    });
    return { success: true, message: 'Dead-letter replayed', data: { jobId } };
  }

  @Delete('dlq/:index')
  async discard(
    @Req() req: any,
    @Param('index') index: string,
    @Query('reason') reason?: string,
  ) {
    const idx = this.parseIndex(index);
    const ok = await this.notifications.discardDeadLetter(
      idx,
      (reason ?? 'no reason given').slice(0, 480),
    );
    if (!ok) throw new NotFoundAppException(`No dead-letter at index ${idx}`);
    await this.audit.writeAuditLog({
      actorId: req?.adminId ?? req?.user?.id,
      action: 'notifications.dlq.discarded',
      module: 'notifications',
      resource: 'NotificationDeadLetter',
      resourceId: String(idx),
      newValue: { reason: reason ?? null },
    });
    return { success: true, message: 'Dead-letter discarded (logged as CANCELLED)' };
  }

  private parseIndex(raw: string): number {
    const idx = Number.parseInt(raw, 10);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new BadRequestAppException('index must be a non-negative integer');
    }
    return idx;
  }
}
