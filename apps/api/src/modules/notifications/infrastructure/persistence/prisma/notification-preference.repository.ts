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

  /**
   * Bulk upsert with a consent-history trail. Phase 189 (#7/#8/#9/#12) —
   * every entry's upsert AND its history row are written inside ONE
   * transaction (atomic: all-or-nothing). The prior `enabled` value is read
   * first so the history captures the real before/after.
   */
  async setMany(
    userId: string,
    entries: Array<{
      eventClass: string;
      channel: NotificationChannel;
      enabled: boolean;
    }>,
    ctx: {
      source: string;
      updatedByAdminId?: string | null;
      bypassReason?: string | null;
      ipAddress?: string | null;
      userAgent?: string | null;
    },
  ): Promise<NotificationPreference[]> {
    if (entries.length === 0) return [];

    // Read prior state for the affected keys (for the history before-value).
    const existing = await this.prisma.notificationPreference.findMany({
      where: { userId, OR: entries.map((e) => ({ eventClass: e.eventClass, channel: e.channel })) },
    });
    const priorMap = new Map(
      existing.map((r) => [`${r.eventClass}::${r.channel}`, r.enabled]),
    );

    return this.prisma.$transaction(async (tx) => {
      const saved: NotificationPreference[] = [];
      for (const e of entries) {
        const oldEnabled = priorMap.get(`${e.eventClass}::${e.channel}`);
        const row = await tx.notificationPreference.upsert({
          where: {
            userId_eventClass_channel: { userId, eventClass: e.eventClass, channel: e.channel },
          },
          create: {
            userId,
            eventClass: e.eventClass,
            channel: e.channel,
            enabled: e.enabled,
            source: ctx.source,
            updatedByAdminId: ctx.updatedByAdminId ?? null,
          },
          update: {
            enabled: e.enabled,
            source: ctx.source,
            updatedByAdminId: ctx.updatedByAdminId ?? null,
          },
        });
        // Only record a history row when the value actually changed (or is new).
        if (oldEnabled === undefined || oldEnabled !== e.enabled) {
          await tx.notificationPreferenceHistory.create({
            data: {
              userId,
              eventClass: e.eventClass,
              channel: e.channel,
              oldEnabled: oldEnabled ?? null,
              newEnabled: e.enabled,
              source: ctx.source,
              updatedByAdminId: ctx.updatedByAdminId ?? null,
              bypassReason: ctx.bypassReason ?? null,
              ipAddress: ctx.ipAddress ?? null,
              userAgent: ctx.userAgent ?? null,
            },
          });
        }
        saved.push(row);
      }
      return saved;
    });
  }

  /** Phase 189 (#9) — consent-change history for a user (newest first). */
  async historyForUser(userId: string, limit = 200) {
    return this.prisma.notificationPreferenceHistory.findMany({
      where: { userId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
  }
}
