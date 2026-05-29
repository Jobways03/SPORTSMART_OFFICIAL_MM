import { Inject, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  JWT_ALGORITHM,
  JWT_AUDIENCE_CUSTOMER,
} from '../../../../core/auth/jwt-constants';
import {
  UnauthorizedAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';
import {
  UserRepository,
  USER_REPOSITORY,
} from '../../domain/repositories/user.repository';
import {
  SessionRepository,
  SESSION_REPOSITORY,
} from '../../domain/repositories/session.repository';

export interface RefreshSessionInput {
  refreshToken: string;
}

export interface RefreshSessionResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class RefreshSessionUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    @Inject(SESSION_REPOSITORY)
    private readonly sessionRepo: SessionRepository,
    private readonly envService: EnvService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('RefreshSessionUseCase');
  }

  async execute(input: RefreshSessionInput): Promise<RefreshSessionResult> {
    const { refreshToken } = input;

    if (!refreshToken) {
      throw new UnauthorizedAppException('Refresh token is required');
    }

    // Look up the session by refresh token
    const session = await this.sessionRepo.findByRefreshToken(refreshToken);
    if (!session) {
      // Phase 3 (PR 3.6) — refresh-token reuse detection. A miss on
      // the current-hash slot might mean (a) bogus token (typo, old
      // logout, etc.) OR (b) the token was rotated away and is now
      // burned — meaning either an attacker just used it, or the
      // legitimate user is retrying a stale one. Either way, a hit
      // on the previous-hash slot means a once-valid token is
      // resurfacing AFTER a rotation. The safe response is to
      // revoke every session for that user: the legitimate owner
      // re-logs in (small inconvenience); the attacker is locked
      // out of every device (the actual goal).
      const reused = await this.sessionRepo.findByPreviousRefreshToken(refreshToken);
      if (reused) {
        this.logger.warn(
          `[SECURITY] Refresh-token reuse detected for user=${reused.userId} session=${reused.id}; revoking all sessions for this user.`,
        );
        await this.sessionRepo.revokeAllUserSessions(reused.userId);
        throw new UnauthorizedAppException(
          'Refresh-token reuse detected — all sessions invalidated for security. Please log in again.',
        );
      }
      throw new UnauthorizedAppException('Invalid refresh token');
    }

    // Verify the session is not revoked or expired
    if (session.revokedAt) {
      throw new UnauthorizedAppException('Session has been revoked');
    }
    // Apply a small grace buffer (60s) to absorb client/server clock
    // skew. Without this, a request issued ~1s before expiry can hit
    // the server post-expiry and force the user to re-login despite
    // having a "valid" token in hand. The theft-detection on the
    // previous-token-hash slot still protects against stale-token
    // replay even within the grace window.
    const REFRESH_EXPIRY_GRACE_MS = 60_000;
    if (session.expiresAt.getTime() + REFRESH_EXPIRY_GRACE_MS < Date.now()) {
      throw new UnauthorizedAppException('Refresh token expired');
    }

    // Phase 17 (2026-05-20) — absolute session lifetime cap.
    //
    // Refresh rotation extends `expiresAt = now + JWT_REFRESH_TTL` on
    // every successful refresh, which makes a daily-active session
    // effectively immortal. This guard enforces a hard ceiling
    // measured from Session.createdAt: past the cap (default 60 days)
    // the rotation is refused and the user must re-authenticate. The
    // window stays generous so it's not a usability footgun, but it
    // means a stolen refresh-token-rotation chain cannot live forever
    // in the wild without a re-login event the legitimate owner
    // would notice.
    const sessionCreatedAt = (session as { createdAt?: Date }).createdAt;
    if (sessionCreatedAt) {
      const lifetimeCapDays = this.envService.getNumber(
        'SESSION_ABSOLUTE_LIFETIME_DAYS',
        60,
      );
      const cutoffMs =
        sessionCreatedAt.getTime() + lifetimeCapDays * 24 * 60 * 60 * 1000;
      if (Date.now() > cutoffMs) {
        // Revoke so subsequent attempts short-circuit on the
        // revoked-at branch rather than re-hitting the absolute-cap
        // computation per call.
        await this.sessionRepo.revoke(session.id);
        throw new UnauthorizedAppException(
          'Session has reached its maximum lifetime. Please sign in again.',
        );
      }
    }

    // Look up the user with current roles (roles may have changed since login)
    const user = (await this.userRepo.findById(session.userId)) as any;
    if (!user) {
      // User was deleted — revoke the session and reject
      await this.sessionRepo.revoke(session.id);
      throw new UnauthorizedAppException('User not found');
    }

    if (user.status !== 'ACTIVE') {
      await this.sessionRepo.revoke(session.id);
      throw new ForbiddenAppException(
        'Account is not active. Please contact support.',
      );
    }

    const roles: string[] = (user.roleAssignments || []).map(
      (ra: any) => ra.role.name,
    );

    // Rotate the refresh token (best practice — limits exposure window)
    const newRefreshToken = randomUUID();
    const refreshTtl = this.parseTimeToMs(
      this.envService.getString('JWT_REFRESH_TTL', '30d'),
    );
    const newExpiresAt = new Date(Date.now() + refreshTtl);
    await this.sessionRepo.rotateRefreshToken(
      session.id,
      newRefreshToken,
      newExpiresAt,
    );

    // Phase 17 (2026-05-20) — access TTL default tightened from 7d to
    // 15m (parity with login). A stolen access token is now valid for
    // at most 15 minutes; refresh rotation refills it for live
    // sessions. Same iss + aud claims as login so the customer guard
    // accepts tokens from both paths.
    const accessTtl = this.envService.getString('JWT_ACCESS_TTL', '15m');
    const accessTtlSeconds = this.parseTimeToSeconds(accessTtl);
    const appUrl = this.envService.getOptional('APP_URL');

    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        roles,
        sessionId: session.id,
      },
      this.envService.getString('JWT_CUSTOMER_SECRET'),
      {
        expiresIn: accessTtlSeconds,
        algorithm: JWT_ALGORITHM,
        audience: JWT_AUDIENCE_CUSTOMER,
        ...(appUrl ? { issuer: appUrl } : {}),
      },
    );

    this.logger.log(`Session refreshed for user: ${user.id}`);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: accessTtlSeconds,
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

  private parseTimeToSeconds(time: string): number {
    return Math.floor(this.parseTimeToMs(time) / 1000);
  }
}
