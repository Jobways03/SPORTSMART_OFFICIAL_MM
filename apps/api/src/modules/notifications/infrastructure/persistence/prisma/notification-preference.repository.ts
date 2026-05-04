import { Injectable } from '@nestjs/common';
import type { NotificationChannel, NotificationPreference } from '@prisma/client';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';

@Injectable()
export class NotificationPreferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns true when the user has NOT opted out of this (eventClass, channel).
   * Absence of a row = enabled (opt-in by default).
   */
  async isEnabled(args: {
    userId: string;
    eventClass: string;
    channel: NotificationChannel;
  }): Promise<boolean> {
    const row = await this.prisma.notificationPreference.findUnique({
      where: {
        userId_eventClass_channel: {
          userId: args.userId,
          eventClass: args.eventClass,
          channel: args.channel,
        },
      },
    });
    return row?.enabled ?? true;
  }

  /** All preferences for a user — used by the storefront settings page. */
  async listForUser(userId: string): Promise<NotificationPreference[]> {
    return this.prisma.notificationPreference.findMany({ where: { userId } });
  }

  /** Bulk upsert — accepts an array of (eventClass, channel, enabled) tuples. */
  async setMany(
    userId: string,
    entries: Array<{
      eventClass: string;
      channel: NotificationChannel;
      enabled: boolean;
    }>,
  ): Promise<NotificationPreference[]> {
    return this.prisma.$transaction(
      entries.map((e) =>
        this.prisma.notificationPreference.upsert({
          where: {
            userId_eventClass_channel: {
              userId,
              eventClass: e.eventClass,
              channel: e.channel,
            },
          },
          create: { userId, eventClass: e.eventClass, channel: e.channel, enabled: e.enabled },
          update: { enabled: e.enabled },
        }),
      ),
    );
  }
}
