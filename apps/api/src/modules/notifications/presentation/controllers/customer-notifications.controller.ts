import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { NotificationChannel } from '@prisma/client';
import { UserAuthGuard } from '../../../../core/guards';
import { NotificationsPublicFacade } from '../../application/facades/notifications-public.facade';

interface UpdatePreferencesDto {
  entries: Array<{
    eventClass: string;
    channel: NotificationChannel;
    enabled: boolean;
  }>;
}

const SUPPORTED_EVENT_CLASSES = ['order', 'refund', 'ticket', 'wallet', 'marketing'];
const SUPPORTED_CHANNELS: NotificationChannel[] = ['EMAIL', 'SMS', 'WHATSAPP'];

@ApiTags('Notifications — Customer')
@Controller('customer/notifications')
@UseGuards(UserAuthGuard)
export class CustomerNotificationsController {
  constructor(private readonly facade: NotificationsPublicFacade) {}

  @Get('preferences')
  async listPreferences(@Req() req: any) {
    const stored = await this.facade.listPreferencesForUser(req.userId);
    // Materialize the full grid (eventClass × channel) so the client
    // doesn't have to know about absence-means-enabled.
    const grid = SUPPORTED_EVENT_CLASSES.flatMap((eventClass) =>
      SUPPORTED_CHANNELS.map((channel) => {
        const found = stored.find(
          (p) => p.eventClass === eventClass && p.channel === channel,
        );
        return {
          eventClass,
          channel,
          enabled: found?.enabled ?? true,
        };
      }),
    );
    return {
      success: true,
      message: 'Preferences retrieved',
      data: { preferences: grid, eventClasses: SUPPORTED_EVENT_CLASSES, channels: SUPPORTED_CHANNELS },
    };
  }

  @Patch('preferences')
  async setPreferences(@Req() req: any, @Body() body: UpdatePreferencesDto) {
    if (!Array.isArray(body?.entries)) {
      return { success: false, message: 'entries[] is required' };
    }
    // Reject unknown classes/channels rather than silently accept (keeps
    // the storefront and API in lockstep on the supported grid).
    for (const e of body.entries) {
      if (!SUPPORTED_EVENT_CLASSES.includes(e.eventClass)) {
        return { success: false, message: `Unknown eventClass: ${e.eventClass}` };
      }
      if (!SUPPORTED_CHANNELS.includes(e.channel)) {
        return { success: false, message: `Unknown channel: ${e.channel}` };
      }
    }
    await this.facade.setPreferencesForUser(req.userId, body.entries);
    return { success: true, message: 'Preferences updated' };
  }
}
