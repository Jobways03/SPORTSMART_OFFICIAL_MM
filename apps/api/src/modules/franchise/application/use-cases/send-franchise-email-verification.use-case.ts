import { Injectable, Inject } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailOtpAdapter } from '../../../../integrations/email/adapters/email-otp.adapter';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  BadRequestAppException,
  TooManyRequestsAppException,
} from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Phase 27 (2026-05-21) — hourly resend cap; mirrors the seller path.
const MAX_RESENDS_PER_HOUR = 5;

/**
 * Phase 20 (2026-05-20) — Franchise email-verification OTP send.
 *
 * Hardening vs prior version:
 *   • Returns `{ sent: boolean }` so the caller (register flow,
 *     resend endpoint) can surface SMTP soft-failure instead of
 *     lying about delivery.
 *   • Cooldown throws TooManyRequestsAppException with a
 *     retry-after surface instead of a generic 400.
 *   • The OTP row is still created BEFORE the send attempt — same
 *     as seller — because invalidating the row on SMTP failure is
 *     trickier than letting the row exist and absorb the cost via
 *     the 60s cooldown. The send result is surfaced so callers can
 *     warn the user.
 */
@Injectable()
export class SendFranchiseEmailVerificationUseCase {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;

  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly emailOtp: EmailOtpAdapter,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    // Phase 27 (2026-05-21) — audit-trail write per send.
    private readonly audit: AuditPublicFacade,
  ) {
    this.logger.setContext('SendFranchiseEmailVerificationUseCase');
  }

  async execute(
    franchiseId: string,
    ctx: RequestContext = { ipAddress: null, userAgent: null },
  ): Promise<{ sent: boolean; retryAfterSeconds?: number }> {
    const franchise = await this.franchiseRepo.findByIdSelect(franchiseId, {
      id: true,
      email: true,
      isEmailVerified: true,
      status: true,
    });

    if (!franchise) {
      // Unknown franchise — uniform no-op so the upstream caller
      // (resend endpoint) can't enumerate by status code.
      return { sent: false };
    }

    if (franchise.isEmailVerified) {
      throw new BadRequestAppException('Email is already verified');
    }

    const recentOtp = await this.franchiseRepo.findRecentOtp({
      franchisePartnerId: franchise.id,
      purpose: 'EMAIL_VERIFICATION',
      unusedOnly: true,
      createdAfter: new Date(
        Date.now() -
          SendFranchiseEmailVerificationUseCase.COOLDOWN_SECONDS * 1000,
      ),
    });

    if (recentOtp) {
      const elapsedMs =
        Date.now() - new Date(recentOtp.createdAt).getTime();
      const remainingMs =
        SendFranchiseEmailVerificationUseCase.COOLDOWN_SECONDS * 1000 -
        elapsedMs;
      const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
      throw new TooManyRequestsAppException(
        `Please wait ${retryAfterSeconds} second(s) before requesting another verification code.`,
      );
    }

    // Phase 27 (2026-05-21) — hourly resend cap (mirrors seller flow).
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await this.franchiseRepo.countOtpsSince(
      franchise.id,
      oneHourAgo,
    );
    if (recentCount >= MAX_RESENDS_PER_HOUR) {
      throw new TooManyRequestsAppException(
        "You've requested too many verification codes recently. Please try again in an hour.",
      );
    }

    await this.franchiseRepo.invalidateActiveOtps(
      franchise.id,
      'EMAIL_VERIFICATION',
    );

    const otp = String(randomInt(100000, 1_000_000));
    const otpHash = createHash('sha256').update(otp).digest('hex');

    await this.franchiseRepo.createOtp({
      franchisePartnerId: franchise.id,
      otpHash,
      purpose: 'EMAIL_VERIFICATION',
      expiresAt: new Date(
        Date.now() +
          SendFranchiseEmailVerificationUseCase.OTP_EXPIRY_MINUTES * 60 * 1000,
      ),
    });

    // Phase 20 (2026-05-20) — capture send result. The adapter
    // returns false on SMTP soft-failure; we surface that so the
    // verify page can show a "we couldn't email you" warning.
    let sent = false;
    try {
      sent = await this.emailOtp.sendOtp(franchise.email, otp);
    } catch (err) {
      sent = false;
      this.logger.error(
        `Email OTP transport threw for franchise ${franchise.id}: ${
          (err as Error)?.message ?? err
        }`,
      );
    }

    this.eventBus
      .publish({
        eventName: 'franchise.email_verification_otp_sent',
        aggregate: 'franchise',
        aggregateId: franchise.id,
        occurredAt: new Date(),
        payload: { franchiseId: franchise.id, sent },
      })
      .catch((err) => {
        this.logger.error(`Failed to publish email verification event: ${err}`);
      });

    if (sent) {
      this.logger.log(
        `Email verification OTP sent for franchise: ${franchise.id}`,
      );
    } else {
      this.logger.warn(
        `Email verification OTP created but transport reported failure for franchise: ${franchise.id}`,
      );
    }

    // Phase 27 (2026-05-21) — audit-trail write.
    this.audit
      .writeAuditLog({
        actorId: franchise.id,
        actorRole: 'FRANCHISE',
        action: 'FRANCHISE_EMAIL_VERIFY_REQUESTED',
        module: 'franchise-auth',
        resource: 'FranchisePartner',
        resourceId: franchise.id,
        newValue: { sent },
        ipAddress: ctx.ipAddress ?? undefined,
        userAgent: ctx.userAgent ?? undefined,
      })
      .catch((err) =>
        this.logger.error(
          `Failed to audit FRANCHISE_EMAIL_VERIFY_REQUESTED for ${franchise.id}: ${(err as Error)?.message}`,
        ),
      );

    return { sent };
  }
}
