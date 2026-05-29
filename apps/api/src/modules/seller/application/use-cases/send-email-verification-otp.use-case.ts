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
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Phase 27 (2026-05-21) — per-seller hourly resend cap. Mirrors the
// affiliate password-reset pattern (MAX_RESENDS_PER_HOUR=5). Defends
// against email-flooding: the 60-second cooldown alone would allow
// 60 resends/hour for a victim seller.
const MAX_RESENDS_PER_HOUR = 5;

/**
 * Phase 18 (2026-05-20) — Seller email-verification OTP send.
 *
 * Used by two paths:
 *   1. RegisterSellerUseCase (right after seller creation).
 *   2. The public ResendVerificationOtpUseCase below (and the older
 *      authed /seller/profile/verify-email/send-otp).
 *
 * The use case is now strict about email-send result: an SMTP failure
 * causes the caller's await to reject (via the bool false → throw
 * translation). The previous "fire-and-forget" pattern meant a seller
 * with a typo'd email saw "success" but never got the OTP.
 */
@Injectable()
export class SendEmailVerificationOtpUseCase {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;

  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly emailOtp: EmailOtpAdapter,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    // Phase 27 (2026-05-21) — write SELLER_EMAIL_VERIFY_REQUESTED on
    // every send so the security audit trail records who tried, when,
    // and from where. Best-effort: a write failure never blocks the
    // user-visible OTP delivery.
    private readonly audit: AuditPublicFacade,
  ) {
    this.logger.setContext('SendEmailVerificationOtpUseCase');
  }

  /**
   * @returns metadata about the dispatch; `sent=false` indicates a
   *          soft SMTP failure (the OTP row was still created so a
   *          subsequent resend doesn't hit the 60s cooldown
   *          uselessly — invalidateActiveOtps clears it).
   */
  async execute(
    sellerId: string,
    ctx: RequestContext = { ipAddress: null, userAgent: null },
  ): Promise<{ sent: boolean; retryAfterSeconds?: number }> {
    const seller = await this.sellerRepo.findByIdSelect(sellerId, {
      id: true,
      email: true,
      isEmailVerified: true,
      status: true,
    });

    if (!seller) {
      // Unknown seller — uniform "no-op" rather than throwing so the
      // upstream caller (resend endpoint) can't be used to enumerate
      // by status code.
      return { sent: false };
    }

    if (seller.isEmailVerified) {
      throw new BadRequestAppException('Email is already verified');
    }

    // Cooldown — only for EMAIL_VERIFICATION purpose.
    const recentOtp = await this.sellerRepo.findRecentOtp({
      sellerId: seller.id,
      purpose: 'EMAIL_VERIFICATION',
      unusedOnly: true,
      createdAfter: new Date(
        Date.now() - SendEmailVerificationOtpUseCase.COOLDOWN_SECONDS * 1000,
      ),
    });

    if (recentOtp) {
      // Compute the remaining cooldown so the caller can show a
      // useful countdown instead of "please wait."
      const elapsedMs = Date.now() - new Date(recentOtp.createdAt).getTime();
      const remainingMs =
        SendEmailVerificationOtpUseCase.COOLDOWN_SECONDS * 1000 - elapsedMs;
      const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
      throw new TooManyRequestsAppException(
        `Please wait ${retryAfterSeconds} second(s) before requesting another verification code.`,
      );
    }

    // Phase 27 (2026-05-21) — per-seller hourly resend cap. The
    // countOtpsSince repo method (added Phase 18) counts all OTPs
    // (any purpose) for this seller in the last hour. Email-verify
    // resends share the budget with password-reset resends, which is
    // intentional: any attacker spamming the seller's inbox is
    // bounded by one global cap regardless of which OTP they target.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await this.sellerRepo.countOtpsSince(
      seller.id,
      oneHourAgo,
    );
    if (recentCount >= MAX_RESENDS_PER_HOUR) {
      throw new TooManyRequestsAppException(
        "You've requested too many verification codes recently. Please try again in an hour.",
      );
    }

    // Invalidate any existing EMAIL_VERIFICATION OTPs first so the
    // verify lookup picks up the new one.
    await this.sellerRepo.invalidateActiveOtps(seller.id, 'EMAIL_VERIFICATION');

    // 6-digit OTP, SHA-256 hashed. randomInt is OS CSPRNG.
    const otp = String(randomInt(100000, 1_000_000));
    const otpHash = createHash('sha256').update(otp).digest('hex');

    await this.sellerRepo.createOtp({
      sellerId: seller.id,
      otpHash,
      purpose: 'EMAIL_VERIFICATION',
      expiresAt: new Date(
        Date.now() + SendEmailVerificationOtpUseCase.OTP_EXPIRY_MINUTES * 60 * 1000,
      ),
    });

    // Phase 18 (2026-05-20) — capture send result. The adapter
    // returns false on SMTP soft-failure rather than throwing; we
    // surface that to the caller so the verify page can show a
    // "we couldn't email you" warning.
    let sent = false;
    try {
      sent = await this.emailOtp.sendOtp(seller.email, otp);
    } catch (err) {
      // Hard send failure (network exception inside the transport,
      // bad credentials, etc.). Log and surface as `sent=false` so
      // the response stays consistent with the soft-fail path.
      sent = false;
      this.logger.error(
        `Email OTP transport threw for seller ${seller.id}: ${
          (err as Error)?.message ?? err
        }`,
      );
    }

    this.eventBus
      .publish({
        eventName: 'seller.email_verification_otp_sent',
        aggregate: 'seller',
        aggregateId: seller.id,
        occurredAt: new Date(),
        payload: { sellerId: seller.id, sent },
      })
      .catch((err) => {
        this.logger.error(`Failed to publish email verification event: ${err}`);
      });

    if (sent) {
      this.logger.log(`Email verification OTP sent for seller: ${seller.id}`);
    } else {
      this.logger.warn(
        `Email verification OTP created but transport reported failure for seller: ${seller.id}`,
      );
    }

    // Phase 27 (2026-05-21) — audit-trail write. Captures who tried,
    // when, IP/UA, whether the dispatch landed. Best-effort.
    this.audit
      .writeAuditLog({
        actorId: seller.id,
        actorRole: 'SELLER',
        action: 'SELLER_EMAIL_VERIFY_REQUESTED',
        module: 'seller-auth',
        resource: 'Seller',
        resourceId: seller.id,
        newValue: { sent },
        ipAddress: ctx.ipAddress ?? undefined,
        userAgent: ctx.userAgent ?? undefined,
      })
      .catch((err) =>
        this.logger.error(
          `Failed to audit SELLER_EMAIL_VERIFY_REQUESTED for ${seller.id}: ${(err as Error)?.message}`,
        ),
      );

    return { sent };
  }
}
