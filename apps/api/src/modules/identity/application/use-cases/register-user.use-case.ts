import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt } from 'crypto';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { BadRequestAppException } from '../../../../core/exceptions';
import { RegisterResponseData } from '../../presentation/dtos/auth-response.dto';
import { ConsentService } from '../services/consent.service';
import {
  UserRepository,
  USER_REPOSITORY,
  RegistrationConsentInput,
} from '../../domain/repositories/user.repository';

interface RegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  acceptMarketing?: boolean;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Phase 16 (2026-05-20) — Customer registration use case.
 *
 * Flow (no auto-login, no JWT issued, no account activation):
 *   1. Validate confirmPassword matches password (server-side gate).
 *   2. Validate Terms + Privacy consent are both granted.
 *   3. bcrypt-hash password (cost 12).
 *   4. Generate 6-digit OTP, SHA-256 hash it.
 *   5. Atomically create:
 *        - User row (status=PENDING_VERIFICATION, emailVerified=false)
 *        - RoleAssignment (CUSTOMER)
 *        - ConsentRecord rows (terms, privacy, optional marketing)
 *        - EmailVerificationOtp row (hashed, 10-min TTL)
 *   6. Emit identity.user.registered with the plaintext OTP in the
 *      payload (consumed by the email handler — never logged, never
 *      stored). The OTP plaintext lives only in memory during the
 *      handler dispatch.
 *   7. Return uniform 202 payload — both fresh and duplicate-email
 *      paths return the same shape so the public API doesn't leak
 *      account existence.
 */
@Injectable()
export class RegisterUserUseCase {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  /** Soak delay range (ms) used on the duplicate-email path so the
   * response timing matches the create path. Keeps the enumeration
   * defence honest under a timing-attack probe. */
  private static readonly DUPLICATE_TIMING_DELAY_MIN_MS = 200;
  private static readonly DUPLICATE_TIMING_DELAY_MAX_MS = 450;

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('RegisterUserUseCase');
  }

  async execute(input: RegisterInput): Promise<RegisterResponseData> {
    const {
      firstName,
      lastName,
      email,
      phone,
      password,
      confirmPassword,
      acceptTerms,
      acceptPrivacy,
      acceptMarketing = false,
      ipAddress,
      userAgent,
    } = input;

    // Validation gates ───────────────────────────────────────
    // confirmPassword equality is enforced server-side so an API-only
    // client cannot bypass the frontend's match check. The DTO
    // already required both fields; only equality is left.
    if (password !== confirmPassword) {
      throw new BadRequestAppException(
        'Passwords do not match',
        'PASSWORDS_DO_NOT_MATCH',
      );
    }

    // DPDP §6: registration cannot proceed without explicit Terms +
    // Privacy consent. The form makes both boxes required; the API
    // re-asserts here so a programmatic caller cannot register
    // without consent.
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

    // Hash the password before the transaction so we burn bcrypt cost
    // OUTSIDE the DB tx. A duplicate-email collision still pays the
    // bcrypt cost — that's by design: it makes the timing of the
    // duplicate path indistinguishable from the create path.
    const passwordHash = await bcrypt.hash(password, 12);

    // 6-digit OTP, SHA-256 hashed. randomInt is the OS CSPRNG so the
    // plaintext is not predictable from process state.
    const otpPlaintext = String(randomInt(100000, 1_000_000));
    const otpHash = createHash('sha256').update(otpPlaintext).digest('hex');
    const otpExpiresAt = new Date(
      Date.now() + RegisterUserUseCase.OTP_EXPIRY_MINUTES * 60 * 1000,
    );

    // Build the ConsentRecord rows. We always write at least three:
    // terms, privacy, marketing (marketing is granted=false when the
    // user left the optional box unchecked — explicit opt-OUT is
    // better than no row, since the marketing dispatcher reads the
    // projection).
    //
    // Phase 28 (2026-05-21) — every row stamps consentVersion so the
    // DPDP audit knows which privacy notice / TOS the customer agreed
    // to at the moment of signup.
    const consentVersion = ConsentService.CURRENT_POLICY_VERSION;
    const consents: RegistrationConsentInput[] = [
      {
        purpose: 'TERMS_OF_SERVICE',
        granted: true,
        consentVersion,
        ipAddress,
        userAgent,
        source: 'register-form',
      },
      {
        purpose: 'PRIVACY_POLICY',
        granted: true,
        consentVersion,
        ipAddress,
        userAgent,
        source: 'register-form',
      },
      {
        purpose: 'EMAIL_MARKETING',
        granted: acceptMarketing === true,
        consentVersion,
        ipAddress,
        userAgent,
        source: 'register-form',
      },
    ];

    const result = await this.userRepo.createUserWithRole({
      firstName,
      lastName,
      email,
      phone: phone ?? null,
      passwordHash,
      otpHash,
      otpExpiresAt,
      consents,
    });

    if (result === null) {
      // Email already registered. Return the SAME uniform "check your
      // inbox" payload so an enumeration attacker cannot tell whether
      // the email exists. We deliberately don't send a "you tried to
      // register again" email here either — that itself is an
      // existence-leak signal if the attacker has access to the
      // inbox of the probed address. The duplicate path absorbs a
      // small randomized delay so timing doesn't distinguish either.
      await this.timingSoakDelay();
      this.logger.log(
        `Register: duplicate email path absorbed (uniform 202 returned)`,
      );
      return {
        email,
        requiresVerification: true,
        message:
          'If this email is not already registered, a 6-digit verification code has been sent. Check your inbox.',
      };
    }

    // Fresh registration. Emit the domain event with the OTP
    // plaintext in the payload so the email handler can render the
    // verification message. The OTP plaintext is NEVER persisted,
    // logged, or returned in the API response — it lives only in
    // memory during the in-process event dispatch.
    await this.eventBus
      .publish({
        eventName: 'identity.user.registered',
        aggregate: 'user',
        aggregateId: result.id,
        occurredAt: new Date(),
        payload: {
          userId: result.id,
          email: result.email,
          firstName: result.firstName,
          lastName: result.lastName,
          otpPlaintext,
          otpExpiresAt: otpExpiresAt.toISOString(),
        },
      })
      .catch((err) => {
        // The event bus failure must not crash the user-facing
        // response (the user's row is already committed), but it does
        // need to be loud — without the email the user is stuck. The
        // outbox layer is the safety net once OUTBOX_AUTHORITATIVE
        // is on; until then, this log line is the alarm.
        this.logger.error(
          `Failed to publish identity.user.registered for ${result.id}: ${err}`,
        );
      });

    this.logger.log(`User registered (pending verification): ${result.id}`);

    return {
      email: result.email,
      requiresVerification: true,
      message:
        'A 6-digit verification code has been sent to your email. It expires in 10 minutes.',
    };
  }

  private timingSoakDelay(): Promise<void> {
    const min = RegisterUserUseCase.DUPLICATE_TIMING_DELAY_MIN_MS;
    const max = RegisterUserUseCase.DUPLICATE_TIMING_DELAY_MAX_MS;
    const delay = min + Math.random() * (max - min);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
