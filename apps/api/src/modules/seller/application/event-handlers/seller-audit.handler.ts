import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

/**
 * Persists every domain event published by the seller module into the
 * structured `audit_logs` table via `AuditPublicFacade.writeAuditLog`.
 *
 * Why this exists alongside the catch-all `DomainEventLogHandler`:
 * the catch-all writes raw event rows into `event_logs` (eventName,
 * aggregate, payload). That's the immutable event stream. The
 * `audit_logs` table is the *structured* per-actor record — what
 * compliance, incident response, and the admin "seller activity"
 * view actually query. It has actor, role, action verb, module,
 * resource, resourceId, metadata. Without this handler, no seller
 * action is queryable that way.
 *
 * Events covered (matches what seller use-cases publish today):
 *   seller.registered
 *   seller.logged_in
 *   seller.login_failed
 *   seller.account_locked
 *   seller.email_verification_otp_sent
 *   seller.email_verified
 *   seller.password_reset_requested
 *   seller.password_reset_completed
 *   seller.password_changed
 *   seller.profile_updated
 *
 * Failures are logged and swallowed — audit writes must never block
 * or break the originating use-case. (Compliance loss is preferable
 * to user-visible 500s. The event_logs catch-all still has the row
 * even if this structured write fails.)
 */
@Injectable()
export class SellerAuditHandler {
  private readonly logger = new Logger(SellerAuditHandler.name);

  constructor(private readonly audit: AuditPublicFacade) {}

  @OnEvent('seller.registered')
  async onRegistered(
    event: DomainEvent<{ sellerId: string; email: string }>,
  ): Promise<void> {
    await this.write(event, 'register', { email: event.payload.email });
  }

  @OnEvent('seller.logged_in')
  async onLoggedIn(
    event: DomainEvent<{ sellerId: string; sessionId: string }>,
  ): Promise<void> {
    await this.write(event, 'login', { sessionId: event.payload.sessionId });
  }

  @OnEvent('seller.login_failed')
  async onLoginFailed(
    event: DomainEvent<{ sellerId: string; identifierType: string }>,
  ): Promise<void> {
    await this.write(event, 'login_failed', {
      identifierType: event.payload.identifierType,
    });
  }

  @OnEvent('seller.account_locked')
  async onAccountLocked(
    event: DomainEvent<{ sellerId: string; lockUntil: Date }>,
  ): Promise<void> {
    await this.write(event, 'account_locked', {
      lockUntil: event.payload.lockUntil,
    });
  }

  @OnEvent('seller.email_verification_otp_sent')
  async onEmailOtpSent(
    event: DomainEvent<{ sellerId: string }>,
  ): Promise<void> {
    await this.write(event, 'email_verification_otp_sent');
  }

  @OnEvent('seller.email_verified')
  async onEmailVerified(
    event: DomainEvent<{ sellerId: string }>,
  ): Promise<void> {
    await this.write(event, 'email_verified');
  }

  @OnEvent('seller.password_reset_requested')
  async onPasswordResetRequested(
    event: DomainEvent<{ sellerId: string }>,
  ): Promise<void> {
    await this.write(event, 'password_reset_requested');
  }

  @OnEvent('seller.password_reset_completed')
  async onPasswordResetCompleted(
    event: DomainEvent<{ sellerId: string }>,
  ): Promise<void> {
    await this.write(event, 'password_reset_completed');
  }

  @OnEvent('seller.password_changed')
  async onPasswordChanged(
    event: DomainEvent<{ sellerId: string }>,
  ): Promise<void> {
    await this.write(event, 'password_changed');
  }

  @OnEvent('seller.profile_updated')
  async onProfileUpdated(
    event: DomainEvent<{ sellerId: string; updatedFields?: string[] }>,
  ): Promise<void> {
    await this.write(event, 'profile_updated', {
      updatedFields: event.payload.updatedFields,
    });
  }

  /**
   * Common write path. Extracts `sellerId` from the event payload and
   * shapes the structured audit row. `actorRole=SELLER` for every
   * seller-aggregate event; downstream queries can filter by role to
   * separate seller activity from admin / customer activity in the
   * same `audit_logs` table.
   */
  private async write(
    event: DomainEvent<{ sellerId?: string }>,
    action: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const sellerId = event.payload?.sellerId;
    if (!sellerId) {
      this.logger.warn(`Audit skipped — no sellerId on event ${event.eventName}`);
      return;
    }
    try {
      await this.audit.writeAuditLog({
        actorId: sellerId,
        actorRole: 'SELLER',
        action,
        module: 'seller',
        resource: 'seller',
        resourceId: sellerId,
        metadata: {
          ...(metadata ?? {}),
          eventName: event.eventName,
          occurredAt: event.occurredAt,
        },
      });
    } catch (err) {
      // Audit failures must never bubble up — the originating use-case
      // has already committed its state and emitted the event. The raw
      // event still lives in `event_logs` via DomainEventLogHandler, so
      // we don't lose forensic ability even if the structured write
      // fails here.
      this.logger.error(
        `Audit write failed for ${event.eventName}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }
}
