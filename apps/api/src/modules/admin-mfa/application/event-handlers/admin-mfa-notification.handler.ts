import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { NotificationsPublicFacade } from '../../../notifications/application/facades/notifications-public.facade';

/**
 * Phase 25 (2026-05-20) — Out-of-band notification for every MFA
 * state change on an admin account.
 *
 * The load-bearing claim of MFA is "even with the password, an
 * attacker can't sign in." That claim erodes silently if an
 * attacker who has the password also gains the ability to ENROL
 * their own MFA on a victim account, or DISABLE the victim's MFA
 * after compromising a session cookie. The first signal a victim
 * sees in either case is a side-channel notification — an email
 * to the address on record, sent from outside the application
 * session that performed the change.
 *
 * Events handled:
 *   • admin.mfa.enrolled               — first-time successful enrolment
 *   • admin.mfa.disabled               — MFA cleared
 *   • admin.mfa.backup_code_consumed   — backup code used (step-up or login)
 *   • admin.mfa.backup_codes_regenerated — operator rotated the 10 codes
 *
 * `admin.mfa.enrolment_started` and `admin.mfa.step_up_verified` are
 * deliberately not notified — they don't alter the protection
 * posture and would just be noise in the admin's inbox.
 */
@Injectable()
export class AdminMfaNotificationHandler {
  private readonly logger = new Logger(AdminMfaNotificationHandler.name);

  constructor(private readonly notifications: NotificationsPublicFacade) {}

  @OnEvent('admin.mfa.enrolled')
  async onEnrolled(event: DomainEvent<MfaEventPayload>): Promise<void> {
    await this.send(event, {
      subject: 'MFA enabled on your SportsMart admin account',
      body:
        `MFA was just enabled on your SportsMart admin account.<br/>` +
        `${this.contextLine(event.payload)}<br/><br/>` +
        `If you did not perform this change, reset your password immediately and contact security.`,
    });
  }

  @OnEvent('admin.mfa.disabled')
  async onDisabled(event: DomainEvent<MfaEventPayload>): Promise<void> {
    await this.send(event, {
      subject: 'MFA was disabled on your SportsMart admin account',
      body:
        `MFA was just disabled on your SportsMart admin account.<br/>` +
        `${this.contextLine(event.payload)}<br/><br/>` +
        `If you did not disable MFA yourself, your session may be compromised. ` +
        `Reset your password immediately and contact security.`,
    });
  }

  @OnEvent('admin.mfa.backup_code_consumed')
  async onBackupCodeConsumed(
    event: DomainEvent<MfaEventPayload>,
  ): Promise<void> {
    await this.send(event, {
      subject: 'A backup code was used on your SportsMart admin account',
      body:
        `One of your single-use MFA backup codes was just consumed.<br/>` +
        `${this.contextLine(event.payload)}<br/><br/>` +
        `If you did not use a backup code yourself, treat your session as compromised. ` +
        `Reset your password and regenerate backup codes via /admin/mfa.`,
    });
  }

  @OnEvent('admin.mfa.backup_codes_regenerated')
  async onCodesRegenerated(
    event: DomainEvent<MfaEventPayload>,
  ): Promise<void> {
    await this.send(event, {
      subject: 'New MFA backup codes were generated on your SportsMart admin account',
      body:
        `A fresh set of 10 MFA backup codes was just generated for your account. ` +
        `Your previous backup codes are no longer valid.<br/>` +
        `${this.contextLine(event.payload)}<br/><br/>` +
        `If you did not request this, your session may be compromised — reset your password immediately.`,
    });
  }

  private async send(
    event: DomainEvent<MfaEventPayload>,
    args: { subject: string; body: string },
  ): Promise<void> {
    const { adminId, email } = event.payload;
    if (!adminId) return;
    try {
      await this.notifications.notify({
        channel: 'EMAIL',
        recipientId: adminId,
        to: email ?? undefined,
        subject: args.subject,
        body: args.body,
        eventType: 'admin.mfa',
        eventId: `${event.eventName}:${adminId}:${event.occurredAt.getTime()}`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send MFA notification ${event.eventName} for admin ${adminId}: ${
          (err as Error).message
        }`,
      );
    }
  }

  private contextLine(p: MfaEventPayload): string {
    const ts = new Date().toISOString();
    const ip = p.ipAddress ?? 'unknown IP';
    return `Time: ${ts} • Source: ${ip}`;
  }
}

interface MfaEventPayload {
  adminId: string;
  email?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  context?: string;
}
