import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Phase 8 (PR 8.2) — Notification gate.
 *
 * Single chokepoint applied before any send. Two checks, in order:
 *
 *   1. **Suppression list** (hard block). A row in
 *      `notification_suppressions` for the (channel, destination)
 *      causes a deny regardless of preferences or transactional flag.
 *      This is for cases where we MUST stop (bounced, spam-complaint,
 *      compliance request).
 *
 *   2. **User preferences**. If the caller doesn't pass `transactional`,
 *      and the user has explicitly opted out of (eventClass, channel),
 *      deny. The default is to allow (no row = enabled).
 *
 * The transactional bypass exists for safety-critical messages:
 * password reset, refund credited, OTP. The caller marks the send as
 * `transactional: true`; the gate then only checks the suppression
 * list. Marketing / reminder sends never set this flag.
 *
 * Returns a structured decision rather than throwing so the caller
 * can record "we suppressed sending" in NotificationLog with the
 * reason — operationally far more useful than a thrown error.
 */
export interface GateInput {
  channel: NotificationChannel;
  destination: string;
  /// User who's the recipient. Null when sending to a raw destination
  /// not tied to a user account (the gate skips the preference check
  /// for these).
  recipientUserId: string | null;
  /// Coarse classification for the preferences lookup. Examples:
  /// "order" | "refund" | "ticket" | "wallet" | "marketing" | "security".
  eventClass: string;
  /// True for messages the user can't opt out of. Suppression list
  /// still wins.
  transactional?: boolean;
}

export type GateDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

@Injectable()
export class NotificationGateService {
  private readonly logger = new Logger(NotificationGateService.name);

  constructor(private readonly prisma: PrismaService) {}

  async check(input: GateInput): Promise<GateDecision> {
    // 1. Suppression list — always wins.
    const sup = await this.prisma.notificationSuppression.findUnique({
      where: {
        channel_destination: {
          channel: input.channel,
          destination: input.destination,
        },
      },
    });
    if (sup) {
      const stillActive = !sup.expiresAt || sup.expiresAt > new Date();
      if (stillActive) {
        return {
          allowed: false,
          reason: `suppressed: ${sup.reason}`,
        };
      }
    }

    // 1b. WhatsApp opt-out — Meta TOS requires that once a user
    // replies STOP, we stop sending. Even transactional sends are
    // blocked (the suppression list above can store the same state,
    // but it lives in a separate table populated by the WhatsApp
    // inbound webhook). Phase 6 (2026-05-16).
    if (input.channel === 'WHATSAPP') {
      const phoneE164 = input.destination.replace(/[^\d]/g, '');
      if (phoneE164) {
        const session = await this.prisma.whatsappSession.findUnique({
          where: { phoneE164 },
          select: { optedOutAt: true, optOutReason: true },
        });
        if (session?.optedOutAt) {
          return {
            allowed: false,
            reason: `whatsapp opted out: ${session.optOutReason ?? 'USER_STOP'}`,
          };
        }
      }
    }

    // 2. Transactional bypass for safety-critical sends.
    if (input.transactional) return { allowed: true };

    // 3. User preference. No user → no preference to check.
    if (!input.recipientUserId) return { allowed: true };

    const pref = await this.prisma.notificationPreference.findUnique({
      where: {
        userId_eventClass_channel: {
          userId: input.recipientUserId,
          eventClass: input.eventClass,
          channel: input.channel,
        },
      },
    });
    if (pref && !pref.enabled) {
      return {
        allowed: false,
        reason: `user opted out of ${input.eventClass}/${input.channel}`,
      };
    }
    return { allowed: true };
  }

  /**
   * Convenience for ops / webhook handlers (e.g. SES bounce webhook).
   * Adds a row to the suppression list, idempotent on (channel, destination).
   */
  async addSuppression(input: {
    channel: NotificationChannel;
    destination: string;
    reason: string;
    addedBy?: string;
    expiresAt?: Date;
  }): Promise<void> {
    await this.prisma.notificationSuppression.upsert({
      where: {
        channel_destination: {
          channel: input.channel,
          destination: input.destination,
        },
      },
      create: {
        channel: input.channel,
        destination: input.destination,
        reason: input.reason,
        addedBy: input.addedBy ?? null,
        expiresAt: input.expiresAt ?? null,
      },
      update: {
        reason: input.reason,
        addedBy: input.addedBy ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    });
  }
}
