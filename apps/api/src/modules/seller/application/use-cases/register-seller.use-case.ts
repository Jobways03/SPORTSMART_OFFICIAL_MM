import { Injectable, Inject } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { BadRequestAppException } from '../../../../core/exceptions';
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
 *   2. Look up existing email/phone. Duplicate → emit the same
 *      uniform payload as a fresh registration (no enumeration).
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
  /** Soak-delay range used on the duplicate path so the timing
   * doesn't distinguish create from absorb. */
  private static readonly DUPLICATE_TIMING_DELAY_MIN_MS = 200;
  private static readonly DUPLICATE_TIMING_DELAY_MAX_MS = 450;

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

    // Uniform "check your inbox" payload — same on both the fresh
    // and duplicate paths so the public API never reveals account
    // existence by either response shape OR by message content.
    const uniformDuplicateResponse: SellerRegisterResponseData = {
      email,
      requiresVerification: true,
      verificationEmailSent: true,
      message:
        'If this email or phone is not already registered, a 6-digit verification code has been sent to your email. Check your inbox.',
    };

    // Application-level duplicate check. We deliberately swallow both
    // email AND phone collisions into the SAME uniform response —
    // the older 409 branches ("phone exists" vs "email exists") let
    // an attacker probe each axis independently.
    const existingByEmail = await this.sellerRepo.findByEmail(email);
    const existingByPhone = await this.sellerRepo.findByPhone(phoneNumber);
    if (existingByEmail || existingByPhone) {
      // Burn ~bcrypt-cost worth of time so the duplicate path's
      // latency profile matches the create path.
      await bcrypt.hash(password, 12);
      await this.timingSoakDelay();
      this.logger.log(
        `Seller register: duplicate email/phone absorbed (uniform 202 returned)`,
      );
      return uniformDuplicateResponse;
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
      // Race-window: a concurrent register beat us to insert. Same
      // uniform response.
      if (error?.code === 'P2002') {
        await this.timingSoakDelay();
        return uniformDuplicateResponse;
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

  private timingSoakDelay(): Promise<void> {
    const min = RegisterSellerUseCase.DUPLICATE_TIMING_DELAY_MIN_MS;
    const max = RegisterSellerUseCase.DUPLICATE_TIMING_DELAY_MAX_MS;
    const delay = min + Math.random() * (max - min);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
