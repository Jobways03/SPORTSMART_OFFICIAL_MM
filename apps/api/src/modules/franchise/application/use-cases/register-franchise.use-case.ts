import { Injectable, Inject } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { BadRequestAppException } from '../../../../core/exceptions';
import { FranchiseRegisterResponseData } from '../../presentation/dtos/franchise-auth-response.dto';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';
import { SendFranchiseEmailVerificationUseCase } from './send-franchise-email-verification.use-case';

interface RegisterFranchiseInput {
  ownerName: string;
  businessName: string;
  email: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  acceptMarketing?: boolean;
}

/**
 * Phase 20 (2026-05-20) — Franchise registration use case.
 *
 *   • confirmPassword + acceptTerms + acceptPrivacy validation.
 *   • Duplicate email/phone → uniform `requiresVerification: true`
 *     payload (no enumeration leak) with timing-soak delay.
 *   • OTP email sent synchronously; surfaced as
 *     `verificationEmailSent` so the verify page can warn the user
 *     if SMTP failed.
 *   • franchise.registered event still fires (Phase 20 also wires a
 *     consumer to send a welcome email).
 */
@Injectable()
export class RegisterFranchiseUseCase {
  private static readonly DUPLICATE_TIMING_DELAY_MIN_MS = 200;
  private static readonly DUPLICATE_TIMING_DELAY_MAX_MS = 450;

  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly eventBus: EventBusService,
    private readonly sendEmailVerificationOtp: SendFranchiseEmailVerificationUseCase,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('RegisterFranchiseUseCase');
  }

  async execute(
    input: RegisterFranchiseInput,
  ): Promise<FranchiseRegisterResponseData> {
    const {
      ownerName,
      businessName,
      email,
      phoneNumber,
      password,
      confirmPassword,
      acceptTerms,
      acceptPrivacy,
    } = input;

    if (password !== confirmPassword) {
      throw new BadRequestAppException(
        'Passwords do not match',
        'PASSWORDS_DO_NOT_MATCH',
      );
    }
    if (acceptTerms !== true) {
      throw new BadRequestAppException(
        'You must agree to the Terms of Service to create an account',
        'TERMS_NOT_ACCEPTED',
      );
    }
    if (acceptPrivacy !== true) {
      throw new BadRequestAppException(
        'You must agree to the Privacy Policy to create an account',
        'PRIVACY_NOT_ACCEPTED',
      );
    }

    const uniformDuplicateResponse: FranchiseRegisterResponseData = {
      email,
      requiresVerification: true,
      verificationEmailSent: true,
      message:
        'If this email or phone is not already registered, a 6-digit verification code has been sent to your email. Check your inbox.',
    };

    const existingByEmail = await this.franchiseRepo.findByEmail(email);
    const existingByPhone = await this.franchiseRepo.findByPhone(phoneNumber);
    if (existingByEmail || existingByPhone) {
      // Burn bcrypt-equivalent time + soak so duplicate-path latency
      // matches create-path latency.
      await bcrypt.hash(password, 12);
      await this.timingSoakDelay();
      this.logger.log(
        `Franchise register: duplicate email/phone absorbed (uniform 202 returned)`,
      );
      return uniformDuplicateResponse;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Retry loop for franchise-code generation race.
    let franchise:
      | Awaited<ReturnType<FranchisePartnerRepository['createFranchise']>>
      | undefined;
    let retries = 3;
    while (retries > 0) {
      const franchiseCode = await this.franchiseRepo.generateNextFranchiseCode();
      try {
        franchise = await this.franchiseRepo.createFranchise({
          ownerName,
          businessName,
          email,
          phoneNumber,
          passwordHash,
          franchiseCode,
        });
        break;
      } catch (error: any) {
        if (error?.code === 'P2002') {
          const target = error?.meta?.target;
          if (target?.includes?.('franchise_code')) {
            retries--;
            if (retries === 0) {
              throw new BadRequestAppException(
                'Failed to generate unique franchise code. Please try again.',
              );
            }
            continue;
          }
          // P2002 on email/phone → race with another concurrent register.
          // Return uniform response (enumeration safety).
          await this.timingSoakDelay();
          return uniformDuplicateResponse;
        }
        throw error;
      }
    }

    const created = franchise!;

    this.eventBus
      .publish({
        eventName: 'franchise.registered',
        aggregate: 'franchise',
        aggregateId: created.id,
        occurredAt: new Date(),
        payload: {
          franchiseId: created.id,
          email: created.email,
          ownerName: created.ownerName,
          businessName: created.businessName,
        },
      })
      .catch((err) => {
        this.logger.error(
          `Failed to publish franchise.registered for ${created.id}: ${err}`,
        );
      });

    let verificationEmailSent = true;
    try {
      const result = await this.sendEmailVerificationOtp.execute(created.id);
      verificationEmailSent = result.sent;
    } catch (err) {
      verificationEmailSent = false;
      this.logger.error(
        `Verification OTP send failed for new franchise ${created.id}: ${
          (err as Error)?.message ?? err
        }`,
      );
    }

    this.logger.log(`Franchise registered: ${created.id}`);

    return {
      email: created.email,
      requiresVerification: true,
      verificationEmailSent,
      message: verificationEmailSent
        ? 'A 6-digit verification code has been sent to your email. It expires in 10 minutes.'
        : 'Your account was created, but we could not send the verification email right now. Please use the resend option on the verification page.',
      franchiseId: created.id,
    };
  }

  private timingSoakDelay(): Promise<void> {
    const min = RegisterFranchiseUseCase.DUPLICATE_TIMING_DELAY_MIN_MS;
    const max = RegisterFranchiseUseCase.DUPLICATE_TIMING_DELAY_MAX_MS;
    const delay = min + Math.random() * (max - min);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
