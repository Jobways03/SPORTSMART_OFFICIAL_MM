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
  SellerRepository,
  SELLER_REPOSITORY,
} from '../../domain/repositories/seller.repository.interface';
import { canLogin } from '../../domain/policies/seller-access.policy';

export interface RefreshSellerSessionInput {
  refreshToken: string;
}

export interface RefreshSellerSessionResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sellerId: string;
}

// 60s grace absorbs client/server clock skew so a request issued ~1s
// before expiry doesn't force a re-login. Mirrors customer / admin refresh.
const REFRESH_EXPIRY_GRACE_MS = 60_000;

// Phase 21 (2026-05-20) — Sliding-refresh has no upper bound by
// default. Without an absolute cap, a daily-active seller never
// re-authenticates; a stolen cookie can be kept alive indefinitely.
// Hard cap measured from Session.createdAt → force re-login.
const SESSION_ABSOLUTE_LIFETIME_DAYS_DEFAULT = 60;

@Injectable()
export class RefreshSellerSessionUseCase {
  constructor(
    @Inject(SELLER_REPOSITORY)
    private readonly sellerRepo: SellerRepository,
    private readonly envService: EnvService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('RefreshSellerSessionUseCase');
  }

  async execute(
    input: RefreshSellerSessionInput,
  ): Promise<RefreshSellerSessionResult> {
    const { refreshToken } = input;
    if (!refreshToken) {
      throw new UnauthorizedAppException('Refresh token is required');
    }

    const session =
      await this.sellerRepo.findSessionByRefreshToken(refreshToken);
    if (!session) {
      // Phase 1 / C6 — refresh-token reuse detection. Primary miss;
      // check the burned-hash slot. A hit means the caller presented
      // an already-rotated token (theft replay). Revoke every session
      // for this seller and refuse.
      const burned =
        await this.sellerRepo.findSessionByPreviousRefreshToken(
          refreshToken,
        );
      if (burned) {
        await this.sellerRepo.revokeAllSessions(burned.sellerId);
        this.logger.warn(
          `Refresh-token reuse detected for seller ${burned.sellerId} — revoked all sessions`,
        );
        throw new UnauthorizedAppException(
          'Session security check failed. Please sign in again.',
        );
      }
      throw new UnauthorizedAppException('Invalid refresh token');
    }
    if (session.revokedAt) {
      throw new UnauthorizedAppException('Session has been revoked');
    }
    if (session.expiresAt.getTime() + REFRESH_EXPIRY_GRACE_MS < Date.now()) {
      throw new UnauthorizedAppException('Refresh token expired');
    }

    // Phase 21 (2026-05-20) — absolute lifetime cap. Even with
    // continuous rotation, a session cannot live beyond
    // createdAt + SESSION_ABSOLUTE_LIFETIME_DAYS. Past that we revoke
    // the session and force a fresh login.
    const absoluteLifetimeDays = Number(
      this.envService.getString(
        'SESSION_ABSOLUTE_LIFETIME_DAYS',
        String(SESSION_ABSOLUTE_LIFETIME_DAYS_DEFAULT),
      ),
    );
    const absoluteCutoffMs =
      session.createdAt.getTime() +
      absoluteLifetimeDays * 24 * 60 * 60 * 1000;
    if (absoluteCutoffMs < Date.now()) {
      await this.sellerRepo.revokeAllSessions(session.sellerId);
      throw new UnauthorizedAppException(
        'Session expired. Please sign in again.',
      );
    }

    const seller = await this.sellerRepo.findById(session.sellerId);
    if (!seller) {
      await this.sellerRepo.revokeAllSessions(session.sellerId);
      throw new UnauthorizedAppException('Seller not found');
    }
    // canLogin() — same gate the login use-case applies. PENDING_APPROVAL
    // sellers are allowed to keep refreshing while they complete onboarding.
    if (!canLogin(seller.status as any)) {
      await this.sellerRepo.revokeAllSessions(session.sellerId);
      throw new ForbiddenAppException(
        'Account is not active. Please contact support.',
      );
    }
    // Phase 21 (2026-05-20) — mirror the login isEmailVerified gate.
    // If an admin or downstream process flipped the seller back to
    // unverified mid-session, refresh must reject (and revoke every
    // session) so the seller re-enters the verify flow.
    if (!(seller as any).isEmailVerified) {
      await this.sellerRepo.revokeAllSessions(session.sellerId);
      throw new ForbiddenAppException(
        'Your email is no longer verified. Please verify your email again to continue.',
        'EMAIL_NOT_VERIFIED',
      );
    }

    // Rotate the refresh token — narrows the exposure window for a stolen
    // token to a single use. The DB hashes the new token; we return raw.
    const newRefreshToken = randomUUID();
    const refreshTtl = this.parseTimeToMs(
      this.envService.getString('JWT_REFRESH_TTL', '30d'),
    );
    const newExpiresAt = new Date(Date.now() + refreshTtl);
    await this.sellerRepo.rotateSession(
      session.id,
      newRefreshToken,
      newExpiresAt,
    );

    const accessTtlSeconds = Math.floor(
      this.parseTimeToMs(this.envService.getString('JWT_ACCESS_TTL', '15m')) /
        1000,
    );
    // JWT_SELLER_SECRET — must match LoginSellerUseCase, otherwise the
    // SellerAuthGuard rejects the new access token.
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

    this.logger.log(`Seller session refreshed: ${seller.id}`);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: accessTtlSeconds,
      sellerId: seller.id,
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
