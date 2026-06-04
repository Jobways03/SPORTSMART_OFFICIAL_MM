import {
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
import { AdminAuthGuard, PermissionsGuard } from '../../../core/guards';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { NotFoundAppException } from '../../../core/exceptions';
import { AuditPublicFacade } from '../../../modules/audit/application/facades/audit-public.facade';
import { OutboxDlqService } from './outbox-dlq.service';

/**
 * Phase 186 (#8/#14) — admin outbox DLQ surface.
 *
 *   GET  /admin/outbox/stats                       — queue-health snapshot
 *   GET  /admin/outbox/dead-letters                — list (filterable)
 *   POST /admin/outbox/dead-letters/:id/replay     — re-enqueue one
 *
 * Reads need `outbox.dlq.read` (MEDIUM); replay needs `outbox.dlq.manage`
 * (HIGH), is throttled, and is audit-logged.
 */
@ApiTags('Admin Outbox')
@Controller('admin/outbox')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminOutboxController {
  constructor(
    private readonly dlq: OutboxDlqService,
    private readonly audit: AuditPublicFacade,
  ) {}

  @Get('stats')
  @Permissions('outbox.dlq.read')
  async stats() {
    const data = await this.dlq.stats();
    return { success: true, message: 'Outbox stats', data };
  }

  @Get('dead-letters')
  @Permissions('outbox.dlq.read')
  async list(
    @Query('eventName') eventName?: string,
    @Query('aggregate') aggregate?: string,
    @Query('aggregateId') aggregateId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.dlq.list({
      eventName: eventName?.trim() || undefined,
      aggregate: aggregate?.trim() || undefined,
      aggregateId: aggregateId?.trim() || undefined,
      page: Math.max(1, Number.parseInt(page ?? '1', 10) || 1),
      limit: Math.min(100, Math.max(1, Number.parseInt(limit ?? '50', 10) || 50)),
    });
    return { success: true, message: 'Dead-letter queue', data };
  }

  @Post('dead-letters/:id/replay')
  @Permissions('outbox.dlq.manage')
  async replay(@Req() req: any, @Param('id') id: string) {
    const newId = await this.dlq.replay(id);
    if (!newId) throw new NotFoundAppException(`No dead-letter ${id}`);
    await this.audit.writeAuditLog({
      actorId: req?.adminId ?? req?.user?.id,
      action: 'outbox.dead_letter.replayed',
      module: 'outbox',
      resource: 'OutboxDeadLetter',
      resourceId: id,
      newValue: { newOutboxEventId: newId },
    });
    return { success: true, message: 'Dead-letter replayed', data: { outboxEventId: newId } };
  }
}
