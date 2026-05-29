import { Injectable, Inject } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { TooManyRequestsAppException } from '../../../../core/exceptions';
import { FranchiseResendVerificationOtpResponseData } from '../../presentation/dtos/franchise-auth-response.dto';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';
import { SendFranchiseEmailVerificationUseCase } from './send-franchise-email-verification.use-case';

interface ResendFranchiseVerificationOtpInput {
  email: string;
}

/**
 * Phase 20 (2026-05-20) — Public resend verification OTP for
 * franchises. Enumeration-safe: response is uniform regardless of
 * whether the email is registered or already verified.
 */
@Injectable()
export class ResendFranchiseVerificationOtpUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly sendOtp: SendFranchiseEmailVerificationUseCase,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ResendFranchiseVerificationOtpUseCase');
  }

  async execute(
    input: ResendFranchiseVerificationOtpInput,
  ): Promise<FranchiseResendVerificationOtpResponseData> {
    const { email } = input;

    const uniform: FranchiseResendVerificationOtpResponseData = {
      email,
      message:
        'If your franchise email is awaiting verification, a new 6-digit code has been sent.',
    };

    const franchise = await this.franchiseRepo.findByEmail(email);

    if (!franchise || franchise.isEmailVerified) {
      await this.simulateDelay();
      return uniform;
    }

    try {
      await this.sendOtp.execute(franchise.id);
      return uniform;
    } catch (err) {
      if (err instanceof TooManyRequestsAppException) {
        return {
          ...uniform,
          retryAfterSeconds: 60,
        };
      }
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
