import { Injectable, Inject } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { TooManyRequestsAppException } from '../../../../core/exceptions';
import { SellerResendVerificationOtpResponseData } from '../../presentation/dtos/seller-auth-response.dto';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';
import { SendEmailVerificationOtpUseCase } from './send-email-verification-otp.use-case';

interface ResendSellerVerificationOtpInput {
  email: string;
}

/**
 * Phase 18 (2026-05-20) — PUBLIC resend verification OTP for sellers.
 *
 * Same enumeration-safety as the forgot-password resend pattern:
 * the response is uniform regardless of whether the email is
 * registered. Internal behaviour:
 *
 *   • Unknown email → uniform success, no OTP issued.
 *   • Already-verified seller → uniform success, no OTP issued.
 *   • Cooldown active (recent OTP within 60s) → return
 *     `retryAfterSeconds` so the frontend can show a countdown,
 *     but still inside the uniform shape.
 *   • Happy path → send-email-verification-otp use case generates
 *     a new OTP; surface `sent` boolean.
 */
@Injectable()
export class ResendSellerVerificationOtpUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly sendOtp: SendEmailVerificationOtpUseCase,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ResendSellerVerificationOtpUseCase');
  }

  async execute(
    input: ResendSellerVerificationOtpInput,
  ): Promise<SellerResendVerificationOtpResponseData> {
    const { email } = input;

    const uniform: SellerResendVerificationOtpResponseData = {
      email,
      message:
        'If your seller email is awaiting verification, a new 6-digit code has been sent.',
    };

    const seller = await this.sellerRepo.findByEmail(email);

    if (!seller || seller.isEmailVerified) {
      // Simulate the timing of the create path so the response time
      // doesn't betray whether the email exists / is verified.
      await this.simulateDelay();
      return uniform;
    }

    // Delegate to the shared send use case so the cooldown +
    // OTP-hash logic stays in one place.
    try {
      const result = await this.sendOtp.execute(seller.id);
      // If we got here, no cooldown error; we know the OTP was
      // attempted. `result.sent` indicates whether SMTP succeeded.
      if (!result.sent) {
        // Same uniform message — the seller can try again in 60s if
        // the email never arrived.
        this.logger.warn(
          `Resend verification OTP transport failed for seller ${seller.id}`,
        );
      }
      return uniform;
    } catch (err) {
      // Cooldown surface — capture the retryAfter and propagate
      // the structured info (still through the uniform shape so
      // enumeration is safe — the cooldown predicate ONLY fires
      // when a recent OTP exists, and that only exists if the
      // seller actually has a pending verification).
      if (err instanceof TooManyRequestsAppException) {
        return {
          ...uniform,
          retryAfterSeconds: 60,
        };
      }
      // Any other error: log and return the uniform success. We
      // don't want a 500 here either, because it would leak
      // "this email triggered server-side work."
      this.logger.error(
        `Resend verification OTP unexpected error for ${email}: ${
          (err as Error)?.message ?? err
        }`,
      );
      return uniform;
    }
  }

  private simulateDelay(): Promise<void> {
    const delay = 100 + Math.random() * 200;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
