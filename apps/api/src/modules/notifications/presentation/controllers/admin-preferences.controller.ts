import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { NotificationsPublicFacade } from '../../application/facades/notifications-public.facade';

@ApiTags('Admin Notifications')
@Controller('admin/notifications/preferences')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminNotificationPreferencesController {
  constructor(private readonly facade: NotificationsPublicFacade) {}

  /**
   * Read-only view of a customer's stored opt-out rows. Used by support
   * agents to triage "I'm not getting emails" complaints. Admin cannot
   * edit — preferences are user-controlled.
   */
  @Get(':userId')
  async list(@Param('userId') userId: string) {
    const stored = await this.facade.listPreferencesForUser(userId);
    return {
      success: true,
      message: 'Preferences retrieved',
      data: { preferences: stored },
    };
  }
}
