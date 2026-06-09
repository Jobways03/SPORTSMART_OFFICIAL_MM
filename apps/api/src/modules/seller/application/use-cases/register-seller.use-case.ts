import { Injectable, Inject } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../../../../core/exceptions';
import { SellerRegisterResponseData } from '../../presentation/dtos/seller-auth-response.dto';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';
import { SendEmailVerificationOtpUseCase } from './send-email-verification-otp.use-case';

interface RegisterSellerInput {
  sellerName: string;
  sellerShopName: string;
  email: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  acceptMarketing?: boolean;
  /**
   * Phase 18 (2026-05-20) — sellerType is now derived SERVER-SIDE by
   * the controller from the X-Seller-Type header (which each portal's
   * api-client bakes in) and reconciled against the request Origin.
   * A D2C portal can no longer submit `sellerType: 'RETAIL'` via the
   * body — the field is removed from the DTO entirely.
   */
  sellerType: 'D2C' | 'RETAIL';
}

/**
 * Phase 18 (2026-05-20) — Seller registration use case.
 *
 * Flow:
 *   1. confirmPassword equality + Terms + Privacy gates.
 *   2. Look up existing email/phone. Duplicate → explicit 409
 *      ALREADY_REGISTERED so the form can tell the user to sign in
 *      (seller-portal product choice — favours UX over anti-enumeration).
 *   3. bcrypt cost 12.
 *   4. Create Seller row with status=PENDING_APPROVAL,
 *      verificationStatus=NOT_VERIFIED, isEmailVerified=false,
 *      sellerType=derived.
 *   5. Synchronously send the verification OTP email and capture
 *      success/failure so the response can surface
 *      `verificationEmailSent: false` when SMTP fails — the verify
 *      page reads that and shows a "resend" prompt instead of
 *      lying about email delivery.
 *   6. Emit seller.registered for welcome-email handler.
 */
@Injectable()
export class RegisterSellerUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    private readonly sendEmailVerificationOtp: SendEmailVerificationOtpUseCase,
  ) {
    this.logger.setContext('RegisterSellerUseCase');
  }

  async execute(input: RegisterSellerInput): Promise<SellerRegisterResponseData> {
    const {
      sellerName,
      sellerShopName,
      email,
      phoneNumber,
      password,
      confirmPassword,
      acceptTerms,
      acceptPrivacy,
      sellerType,
    } = input;

    // Server-side equality gate. The DTO requires confirmPassword to
    // be non-empty; only equality is left to check.
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

    // Explicit duplicate signal (product decision 2026-06-09). The seller
    // portal favours clear onboarding UX over strict anti-enumeration: tell the
    // user outright that an account already exists and send them to sign-in,
    // instead of the old uniform "check your inbox" 202. Trade-off: a probe can
    // now confirm a registered email/phone — accepted for the seller portal,
    // and bounded by this endpoint's 3/min/IP throttle + CAPTCHA gate. (The
    // out-of-band owner-notice email was dropped as redundant once the form
    // states it directly.)
    const existingByEmail = await this.sellerRepo.findByEmail(email);
    const existingByPhone = await this.sellerRepo.findByPhone(phoneNumber);
    if (existingByEmail || existingByPhone) {
      this.logger.log(
        'Seller register: duplicate email/phone rejected (409 ALREADY_REGISTERED)',
      );
      throw new ConflictAppException(
        'An account with this email or phone number already exists. Please sign in instead.',
      );
    }

    // Hash password BEFORE the create so the bcrypt cost is paid
    // outside the DB tx and the duplicate path's timing matches.
    const passwordHash = await bcrypt.hash(password, 12);

    let sellerId: string;
    try {
      const seller = await this.sellerRepo.createSeller({
        sellerName,
        sellerShopName,
        email,
        phoneNumber,
        passwordHash,
        sellerType,
      });
      sellerId = seller.id;
    } catch (error: any) {
      // Race-window: a concurrent register won the unique-constraint race —
      // surface the same explicit "already registered" 409 as the pre-check.
      if (error?.code === 'P2002') {
        throw new ConflictAppException(
          'An account with this email or phone number already exists. Please sign in instead.',
        );
      }
      throw error;
    }

    // Emit the welcome-email event. Best-effort: a failure here
    // means the welcome email doesn't ship, but the seller still
    // gets the verification OTP below.
    this.eventBus
      .publish({
        eventName: 'seller.registered',
        aggregate: 'seller',
        aggregateId: sellerId,
        occurredAt: new Date(),
        payload: { sellerId, email },
      })
      .catch((err) => {
        this.logger.error(
          `Failed to publish seller.registered for ${sellerId}: ${err}`,
        );
      });

    // Phase 18 (2026-05-20) — send the verification OTP synchronously
    // and surface success/failure in the response. The audit flagged
    // the prior fire-and-forget pattern as a critical UX gap: when
    // SMTP failed the seller saw "success" but never got an email,
    // and the 60s cooldown then blocked an immediate resend. By
    // awaiting the send AND catching its error, we can tell the
    // verify page to skip straight to a resend prompt.
    let verificationEmailSent = true;
    try {
      const result = await this.sendEmailVerificationOtp.execute(sellerId);
      verificationEmailSent = result.sent;
    } catch (err) {
      verificationEmailSent = false;
      this.logger.error(
        `Verification OTP send failed for new seller ${sellerId}: ${
          (err as Error)?.message ?? err
        }`,
      );
    }

    this.logger.log(`Seller registered: ${sellerId}`);

    return {
      sellerId,
      email,
      requiresVerification: true,
      verificationEmailSent,
      message: verificationEmailSent
        ? 'A 6-digit verification code has been sent to your email. It expires in 10 minutes.'
        : 'Your account was created, but we could not send the verification email right now. Please use the resend option on the verification page.',
    };
  }

}
