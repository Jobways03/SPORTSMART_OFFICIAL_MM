import { Injectable, Inject } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException, ForbiddenAppException } from '../../../../core/exceptions';
import { FranchiseLoginResponseData } from '../../presentation/dtos/franchise-auth-response.dto';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

// Pre-hash a dummy password for timing attack prevention
const DUMMY_HASH = '$2a$12$LJ3m4ys3Lg7VhMQdxlGC7.BQJ1HFpR9PQXHs1GKTTl1C5KVhJvtNi';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

interface LoginFranchiseInput {
  identifier: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class LoginFranchiseUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly envService: EnvService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('LoginFranchiseUseCase');
  }

  async execute(input: LoginFranchiseInput): Promise<FranchiseLoginResponseData> {
    const { identifier, password, userAgent, ipAddress } = input;

    // Detect identifier type
    const isEmail = identifier.includes('@');
    const lookupValue = isEmail ? identifier.toLowerCase() : identifier.replace(/\D/g, '');

    // Find franchise
    const franchise = isEmail
      ? await this.franchiseRepo.findByEmail(lookupValue)
      : await this.franchiseRepo.findByPhone(lookupValue);

    if (!franchise) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw new UnauthorizedAppException('Invalid credentials');
    }

    // Check account status — PENDING partners can log in to complete their profile
    // Only SUSPENDED and DEACTIVATED are blocked
    if (['SUSPENDED', 'DEACTIVATED'].includes(franchise.status)) {
      throw new ForbiddenAppException('Account has been suspended or deactivated. Please contact support.');
    }

    // Check lockout
    if (franchise.lockUntil && franchise.lockUntil > new Date()) {
      const remainingMs = franchise.lockUntil.getTime() - Date.now();
      const remainingMinutes = Math.ceil(remainingMs / 60000);
      throw new UnauthorizedAppException(
        `Account temporarily locked due to too many failed attempts. Try again after ${remainingMinutes} minute(s).`,
      );
    }

    // Compare password
    const isPasswordValid = await bcrypt.compare(password, franchise.passwordHash);

    if (!isPasswordValid) {
      const newAttempts = franchise.failedLoginAttempts + 1;

      const updateData: Record<string, unknown> = { failedLoginAttempts: newAttempts };

      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        updateData.lockUntil = new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000);

        this.eventBus.publish({
          eventName: 'franchise.account_locked',
          aggregate: 'franchise',
          aggregateId: franchise.id,
          occurredAt: new Date(),
          payload: { franchiseId: franchise.id, lockUntil: updateData.lockUntil },
        }).catch(() => {});
      }

      await this.franchiseRepo.updateFranchise(franchise.id, updateData);

      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        throw new UnauthorizedAppException(
          `Account temporarily locked due to too many failed attempts. Try again after ${LOCK_DURATION_MINUTES} minute(s).`,
        );
      }

      this.eventBus.publish({
        eventName: 'franchise.login_failed',
        aggregate: 'franchise',
        aggregateId: franchise.id,
        occurredAt: new Date(),
        payload: { franchiseId: franchise.id, identifierType: isEmail ? 'email' : 'phone' },
      }).catch(() => {});

      throw new UnauthorizedAppException('Invalid credentials');
    }

    // Successful login — reset counters
    await this.franchiseRepo.updateFranchise(franchise.id, {
      failedLoginAttempts: 0,
      lockUntil: null,
      lastLoginAt: new Date(),
    });

    // Create session
    const refreshToken = randomUUID();
    const refreshTtl = this.parseTimeToMs(this.envService.getString('JWT_REFRESH_TTL', '30d'));
    const expiresAt = new Date(Date.now() + refreshTtl);

    const session = await this.franchiseRepo.createSession({
      franchisePartnerId: franchise.id,
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
        sub: franchise.id,
        email: franchise.email,
        roles: ['FRANCHISE'],
        sessionId: session.id,
      },
      this.envService.getString('JWT_FRANCHISE_SECRET'),
      { expiresIn: accessTtlSeconds },
    );

    // Emit event
    this.eventBus.publish({
      eventName: 'franchise.logged_in',
      aggregate: 'franchise',
      aggregateId: franchise.id,
      occurredAt: new Date(),
      payload: { franchiseId: franchise.id, sessionId: session.id },
    }).catch((err) => {
      this.logger.error(`Failed to publish franchise login event: ${err}`);
    });

    this.logger.log(`Franchise logged in: ${franchise.id}`);

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtlSeconds,
      franchise: {
        franchiseId: franchise.id,
        franchiseCode: franchise.franchiseCode,
        ownerName: franchise.ownerName,
        businessName: franchise.businessName,
        email: franchise.email,
        phoneNumber: franchise.phoneNumber,
        roles: ['FRANCHISE'],
        status: franchise.status,
      },
    };
  }

  private parseTimeToMs(time: string): number {
    const match = time.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 30 * 24 * 60 * 60 * 1000;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return value * (multipliers[unit] || 1000);
  }
}
