import { Inject, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { JWT_ALGORITHM } from '../../../../core/auth/jwt-constants';
import {
  UnauthorizedAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

export interface RefreshFranchiseSessionInput {
  refreshToken: string;
}

export interface RefreshFranchiseSessionResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  franchisePartnerId: string;
}

// 60s grace absorbs client/server clock skew so a request issued ~1s
// before expiry doesn't force a re-login. Mirrors customer / admin / seller refresh.
const REFRESH_EXPIRY_GRACE_MS = 60_000;

// Same gate the login use-case applies: SUSPENDED and DEACTIVATED are
// blocked outright. PENDING is allowed so the partner can keep completing
// KYC; FranchiseActiveGuard separately blocks business actions.
const BLOCKED_STATUSES = new Set(['SUSPENDED', 'DEACTIVATED']);

@Injectable()
export class RefreshFranchiseSessionUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly envService: EnvService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('RefreshFranchiseSessionUseCase');
  }

  async execute(
    input: RefreshFranchiseSessionInput,
  ): Promise<RefreshFranchiseSessionResult> {
    const { refreshToken } = input;
    if (!refreshToken) {
      throw new UnauthorizedAppException('Refresh token is required');
    }

    const session =
      await this.franchiseRepo.findSessionByRefreshToken(refreshToken);
    if (!session) {
      throw new UnauthorizedAppException('Invalid refresh token');
    }
    if (session.revokedAt) {
      throw new UnauthorizedAppException('Session has been revoked');
    }
    if (session.expiresAt.getTime() + REFRESH_EXPIRY_GRACE_MS < Date.now()) {
      throw new UnauthorizedAppException('Refresh token expired');
    }

    const franchise = await this.franchiseRepo.findById(
      session.franchisePartnerId,
    );
    if (!franchise) {
      await this.franchiseRepo.revokeAllSessions(session.franchisePartnerId);
      throw new UnauthorizedAppException('Franchise partner not found');
    }
    if (BLOCKED_STATUSES.has(franchise.status as string)) {
      await this.franchiseRepo.revokeAllSessions(session.franchisePartnerId);
      throw new ForbiddenAppException(
        'Account has been suspended or deactivated. Please contact support.',
      );
    }

    // Rotate the refresh token — narrows the exposure window for a stolen
    // token to a single use. The DB hashes the new token; we return raw.
    const newRefreshToken = randomUUID();
    const refreshTtl = this.parseTimeToMs(
      this.envService.getString('JWT_REFRESH_TTL', '30d'),
    );
    const newExpiresAt = new Date(Date.now() + refreshTtl);
    await this.franchiseRepo.rotateSession(
      session.id,
      newRefreshToken,
      newExpiresAt,
    );

    const accessTtlSeconds = Math.floor(
      this.parseTimeToMs(this.envService.getString('JWT_ACCESS_TTL', '7d')) /
        1000,
    );
    // JWT_FRANCHISE_SECRET — must match LoginFranchiseUseCase, otherwise
    // the FranchiseAuthGuard rejects the new access token.
    const accessToken = jwt.sign(
      {
        sub: franchise.id,
        email: franchise.email,
        roles: ['FRANCHISE'],
        sessionId: session.id,
      },
      this.envService.getString('JWT_FRANCHISE_SECRET'),
      { expiresIn: accessTtlSeconds, algorithm: JWT_ALGORITHM },
    );

    this.logger.log(`Franchise session refreshed: ${franchise.id}`);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: accessTtlSeconds,
      franchisePartnerId: franchise.id,
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
