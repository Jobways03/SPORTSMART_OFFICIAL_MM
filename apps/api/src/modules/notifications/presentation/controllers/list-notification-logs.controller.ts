import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { NotificationChannel, NotificationStatus } from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { NotFoundAppException } from '../../../../core/exceptions';
import { NotificationLogRepository } from '../../infrastructure/persistence/prisma/notification-log.repository';
import { NotificationsPublicFacade } from '../../application/facades/notifications-public.facade';

@ApiTags('Admin Notifications')
@Controller('admin/notifications/logs')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminNotificationLogsController {
  constructor(
    private readonly logs: NotificationLogRepository,
    private readonly notifications: NotificationsPublicFacade,
  ) {}

  @Get()
  async list(
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
      channel: channel ? (channel.toUpperCase() as NotificationChannel) : undefined,
      status: status ? (status.toUpperCase() as NotificationStatus) : undefined,
      recipientId: recipientId?.trim() || undefined,
      eventType: eventType?.trim() || undefined,
      search: search?.trim() || undefined,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
    });
    return { success: true, message: 'Logs retrieved', data };
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const log = await this.logs.findById(id);
    if (!log) throw new NotFoundAppException('Log not found');
    return { success: true, message: 'Log retrieved', data: log };
  }

  /**
   * Re-enqueue a previously-sent notification. Useful when the message
   * was lost downstream (mailbox bounce, SMS provider outage). Captures
   * the original render so the caller doesn't need to re-supply vars.
   */
  @Post(':id/retry')
  async retry(@Param('id') id: string) {
    const log = await this.logs.findById(id);
    if (!log) throw new NotFoundAppException('Log not found');
    await this.notifications.notify({
      channel: log.channel,
      recipientId: log.recipientId ?? undefined,
      to: log.recipientId ? undefined : log.destination,
      templateKey: log.templateKey ?? undefined,
      subject: log.subject ?? undefined,
      body: log.body,
      eventType: log.eventType ?? 'admin.retry',
      eventId: id,
    });
    return { success: true, message: 'Notification re-enqueued' };
  }
}
