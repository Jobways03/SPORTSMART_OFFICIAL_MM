import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { JWT_ALGORITHM } from '../../../../core/auth/jwt-constants';
import { hashRefreshToken } from '../../../../core/auth/refresh-token';
import {
  ForbiddenAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';

export interface RefreshAffiliateSessionResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  affiliateId: string;
}

// 60s grace absorbs client/server clock skew so a request issued ~1s
// before expiry doesn't force a re-login. Mirrors the four other
// persona refresh use-cases.
const REFRESH_EXPIRY_GRACE_MS = 60_000;

// SRS §6.2 + §16.1 — same gate the login service applies.
// REJECTED + SUSPENDED accounts can't refresh either; we revoke their
// sessions on the way out so leaked tokens become inert.
const BLOCKED_STATUSES = new Set(['REJECTED', 'SUSPENDED']);

@Injectable()
export class AffiliateRefreshSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envService: EnvService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AffiliateRefreshSessionService');
  }

  async refresh(refreshToken: string): Promise<RefreshAffiliateSessionResult> {
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new UnauthorizedAppException('Refresh token is required');
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const session = await this.prisma.affiliateSession.findFirst({
      where: { refreshToken: tokenHash },
      select: {
        id: true,
        affiliateId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (!session) {
      // Follow-up #123 / C6 — refresh-token reuse detection. Primary
      // miss; check the burned-hash slot. A hit means the legitimate
      // client already rotated this token → replay → revoke all
      // sessions for the affiliate.
      const burned = await this.prisma.affiliateSession.findFirst({
        where: { previousRefreshTokenHash: tokenHash },
        select: { id: true, affiliateId: true },
      });
      if (burned) {
        await this.prisma.affiliateSession.updateMany({
          where: { affiliateId: burned.affiliateId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        this.logger.warn(
          `Refresh-token reuse detected for affiliate ${burned.affiliateId} — revoked all sessions`,
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

    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: session.affiliateId },
      select: { id: true, email: true, status: true },
    });
    if (!affiliate) {
      await this.prisma.affiliateSession.updateMany({
        where: { affiliateId: session.affiliateId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedAppException('Affiliate not found');
    }
    if (BLOCKED_STATUSES.has(affiliate.status as string)) {
      await this.prisma.affiliateSession.updateMany({
        where: { affiliateId: session.affiliateId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new ForbiddenAppException(
        'Your affiliate account is no longer active. Please contact support.',
      );
    }

    // Rotate the refresh token — narrows the exposure window for a
    // stolen refresh token to a single use. The DB stores the SHA-256
    // hash; we return the raw token. The prior hash moves to
    // previous_refresh_token_hash for the reuse-detection slot.
    const newRefreshToken = randomUUID();
    const newRefreshTtlMs = 30 * 24 * 60 * 60 * 1000;
    const newExpiresAt = new Date(Date.now() + newRefreshTtlMs);

    await this.prisma.affiliateSession.update({
      where: { id: session.id },
      data: {
        previousRefreshTokenHash: tokenHash,
        refreshToken: hashRefreshToken(newRefreshToken),
        expiresAt: newExpiresAt,
      },
    });

    const accessTtlSeconds = 60 * 60; // 1h, matches login
    const accessToken = jwt.sign(
      {
        sub: affiliate.id,
        email: affiliate.email,
        roles: ['AFFILIATE'],
        sessionId: session.id,
      },
      this.envService.getString('JWT_AFFILIATE_SECRET'),
      { expiresIn: accessTtlSeconds, algorithm: JWT_ALGORITHM },
    );

    this.logger.log(`Affiliate session refreshed: ${affiliate.id}`);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: accessTtlSeconds,
      affiliateId: affiliate.id,
    };
  }
}
