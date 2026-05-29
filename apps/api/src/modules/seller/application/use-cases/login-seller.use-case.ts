import { Injectable, Inject } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { JWT_ALGORITHM } from '../../../../core/auth/jwt-constants';
import { hashPassword, shouldRehash } from '../../../../core/auth/bcrypt-policy';
import { UnauthorizedAppException, ForbiddenAppException } from '../../../../core/exceptions';
import { SellerLoginResponseData } from '../../presentation/dtos/seller-auth-response.dto';
import {
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';
import { canLogin } from '../../domain/policies/seller-access.policy';

// Pre-hash a dummy password for timing attack prevention
const DUMMY_HASH = '$2a$12$LJ3m4ys3Lg7VhMQdxlGC7.BQJ1HFpR9PQXHs1GKTTl1C5KVhJvtNi';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

interface LoginSellerInput {
  identifier: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class LoginSellerUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly envService: EnvService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('LoginSellerUseCase');
  }

  async execute(input: LoginSellerInput): Promise<SellerLoginResponseData> {
    const { identifier, password, userAgent, ipAddress } = input;

    // Detect identifier type
    const isEmail = identifier.includes('@');
    const lookupValue = isEmail ? identifier.toLowerCase() : identifier.replace(/\D/g, '');

    // Find seller
    const seller = isEmail
      ? await this.sellerRepo.findByEmail(lookupValue)
      : await this.sellerRepo.findByPhone(lookupValue);

    if (!seller) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw new UnauthorizedAppException('Invalid credentials');
    }

    // Account-status gate — see `seller-access.policy.ts` for the
    // canonical rule and rationale. PENDING_APPROVAL sellers are
    // intentionally allowed to authenticate so they can complete
    // their profile while waiting for admin review; downstream
    // services (allocation, payouts) gate on ACTIVE separately.
    if (!canLogin(seller.status)) {
      throw new ForbiddenAppException('Account is not active. Please contact support.');
    }

    // Phase 18 (2026-05-20) — block login for sellers whose email has
    // not been verified yet. The pre-Phase-18 use case allowed
    // PENDING_APPROVAL sellers to log in regardless of verification
    // state, which contradicted the audit's "login should be blocked
    // until verification" expectation. Verification first (via the
    // public /seller/auth/verify-email endpoint), login second. The
    // frontend reads `code: EMAIL_NOT_VERIFIED` to route the user to
    // /register/verify with their email pre-filled.
    if (!seller.isEmailVerified) {
      throw new ForbiddenAppException(
        'Your email is not verified. Please check your inbox or request a new verification code.',
        'EMAIL_NOT_VERIFIED',
      );
    }

    // Check lockout
    if (seller.lockUntil && seller.lockUntil > new Date()) {
      const remainingMs = seller.lockUntil.getTime() - Date.now();
      const remainingMinutes = Math.ceil(remainingMs / 60000);
      throw new UnauthorizedAppException(
        `Account temporarily locked due to too many failed attempts. Try again after ${remainingMinutes} minute(s).`,
      );
    }

    // Compare password
    const isPasswordValid = await bcrypt.compare(password, seller.passwordHash);

    if (!isPasswordValid) {
      const newAttempts = seller.failedLoginAttempts + 1;

      const updateData: Record<string, unknown> = { failedLoginAttempts: newAttempts };

      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        updateData.lockUntil = new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000);

        this.eventBus.publish({
          eventName: 'seller.account_locked',
          aggregate: 'seller',
          aggregateId: seller.id,
          occurredAt: new Date(),
          payload: { sellerId: seller.id, lockUntil: updateData.lockUntil },
        }).catch(() => {});
      }

      await this.sellerRepo.updateSeller(seller.id, updateData);

      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        throw new UnauthorizedAppException(
          `Account temporarily locked due to too many failed attempts. Try again after ${LOCK_DURATION_MINUTES} minute(s).`,
        );
      }

      this.eventBus.publish({
        eventName: 'seller.login_failed',
        aggregate: 'seller',
        aggregateId: seller.id,
        occurredAt: new Date(),
        payload: { sellerId: seller.id, identifierType: isEmail ? 'email' : 'phone' },
      }).catch(() => {});

      throw new UnauthorizedAppException('Invalid credentials');
    }

    // Successful login — reset counters
    await this.sellerRepo.updateSeller(seller.id, {
      failedLoginAttempts: 0,
      lockUntil: null,
      lastLoginAt: new Date(),
    });

    // Phase 13 (2026-05-16) — opportunistic rehash. Legacy hashes
    // below the target cost get re-hashed silently on next sign-in.
    if (shouldRehash(seller.passwordHash)) {
      try {
        const upgraded = await hashPassword(password);
        await this.sellerRepo.updateSeller(seller.id, { passwordHash: upgraded });
      } catch (err) {
        this.logger.warn(
          `Failed to rehash seller ${seller.id} on login: ${(err as Error).message}`,
          'LoginSellerUseCase',
        );
      }
    }

    // Create session
    const refreshToken = randomUUID();
    const refreshTtl = this.parseTimeToMs(this.envService.getString('JWT_REFRESH_TTL', '30d'));
    const expiresAt = new Date(Date.now() + refreshTtl);

    const session = await this.sellerRepo.createSession({
      sellerId: seller.id,
      refreshToken,
      userAgent: userAgent || null,
      ipAddress: ipAddress || null,
      expiresAt,
    });

    // Generate access token
    const accessTtl = this.envService.getString('JWT_ACCESS_TTL', '7d');
    const accessTtlSeconds = Math.floor(this.parseTimeToMs(accessTtl) / 1000);

    const accessToken = jwt.sign(
      {
        sub: seller.id,
        email: seller.email,
        roles: ['SELLER'],
        sessionId: session.id,
      },
      this.envService.getString('JWT_SELLER_SECRET'),
      { expiresIn: accessTtlSeconds, algorithm: JWT_ALGORITHM },
    );

    // Emit event
    this.eventBus.publish({
      eventName: 'seller.logged_in',
      aggregate: 'seller',
      aggregateId: seller.id,
      occurredAt: new Date(),
      payload: { sellerId: seller.id, sessionId: session.id },
    }).catch((err) => {
      this.logger.error(`Failed to publish seller login event: ${err}`);
    });

    this.logger.log(`Seller logged in: ${seller.id}`);

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtlSeconds,
      seller: {
        sellerId: seller.id,
        sellerName: seller.sellerName,
        sellerShopName: seller.sellerShopName,
        email: seller.email,
        phoneNumber: seller.phoneNumber,
        roles: ['SELLER'],
        status: seller.status,
        isEmailVerified: seller.isEmailVerified,
      },
    };
  }

  private parseTimeToMs(time: string): number {
    const match = time.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 30 * 24 * 60 * 60 * 1000;
    const value = parseInt(match[1]!, 10);
    const unit = match[2]!;
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return value * (multipliers[unit] || 1000);
  }
}
