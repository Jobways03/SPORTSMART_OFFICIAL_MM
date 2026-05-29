import { Inject, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  JWT_ALGORITHM,
  JWT_AUDIENCE_ADMIN,
} from '../../../../core/auth/jwt-constants';
import {
  UnauthorizedAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

export interface RefreshAdminSessionInput {
  refreshToken: string;
}

export interface RefreshAdminSessionResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  adminId: string;
  role: string;
}

// 60s grace absorbs client/server clock skew so a request issued ~1s
// before expiry doesn't force a re-login. Mirrors the customer refresh
// for consistency across actors.
const REFRESH_EXPIRY_GRACE_MS = 60_000;

// Phase 23 (2026-05-20) — Absolute session lifetime cap. Without this,
// sliding refresh keeps a daily-active admin session alive indefinitely
// — a stolen cookie can be kept fresh forever. Cap measured from
// AdminSession.createdAt; past this we revoke and force a fresh login.
// Default 60 days; configurable.
const SESSION_ABSOLUTE_LIFETIME_DAYS_DEFAULT = 60;

@Injectable()
export class RefreshAdminSessionUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly envService: EnvService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('RefreshAdminSessionUseCase');
  }

  async execute(
    input: RefreshAdminSessionInput,
  ): Promise<RefreshAdminSessionResult> {
    const { refreshToken } = input;
    if (!refreshToken) {
      throw new UnauthorizedAppException('Refresh token is required');
    }

    const session =
      await this.adminRepo.findAdminSessionByRefreshToken(refreshToken);
    if (!session) {
      // Phase 1 / C6 — refresh-token reuse detection. Primary slot
      // missed; check the burned-hash slot. A hit means the caller
      // presented a token that was already rotated out — i.e. the
      // token was stolen at some prior moment, the legitimate client
      // rotated it (creating the burned-hash entry), and the
      // attacker is now replaying the original. Revoke every session
      // for this admin and refuse.
      const burned =
        await this.adminRepo.findAdminSessionByPreviousRefreshToken(
          refreshToken,
        );
      if (burned) {
        await this.adminRepo.revokeAdminSessions(burned.adminId);
        this.logger.warn(
          `Refresh-token reuse detected for admin ${burned.adminId} — revoked all sessions`,
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

    // Phase 23 (2026-05-20) — Absolute-lifetime cap. Even with
    // continuous rotation a session cannot live beyond
    // createdAt + SESSION_ABSOLUTE_LIFETIME_DAYS. Past that we revoke
    // every active session for the admin and force a fresh login.
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
      await this.adminRepo.revokeAdminSessions(session.adminId);
      throw new UnauthorizedAppException(
        'Session expired. Please sign in again.',
      );
    }

    const admin = await this.adminRepo.findAdminById(session.adminId);
    if (!admin) {
      // Admin row gone but session row survived — revoke the orphan and reject.
      await this.adminRepo.revokeAdminSessions(session.adminId);
      throw new UnauthorizedAppException('Admin not found');
    }
    if (admin.status !== 'ACTIVE') {
      await this.adminRepo.revokeAdminSessions(session.adminId);
      throw new ForbiddenAppException('Admin account is not active');
    }

    // Rotate the refresh token — narrows the exposure window for a stolen
    // token to a single use. The DB hashes the new token; we return raw.
    const newRefreshToken = randomUUID();
    const refreshTtl = this.parseTimeToMs(
      this.envService.getString('JWT_REFRESH_TTL', '30d'),
    );
    const newExpiresAt = new Date(Date.now() + refreshTtl);
    await this.adminRepo.rotateAdminSession(
      session.id,
      newRefreshToken,
      newExpiresAt,
    );

    // Phase 23 (2026-05-20) — fallback tightened from '7d' → '15m'.
    const accessTtlSeconds = Math.floor(
      this.parseTimeToMs(this.envService.getString('JWT_ACCESS_TTL', '15m')) /
        1000,
    );
    // JWT_ADMIN_SECRET — must match what AdminLoginUseCase signs with,
    // otherwise AdminAuthGuard would reject the new access token.
    const accessToken = jwt.sign(
      {
        sub: admin.id,
        email: admin.email,
        role: admin.role,
        sessionId: session.id,
      },
      this.envService.getString('JWT_ADMIN_SECRET'),
      {
        expiresIn: accessTtlSeconds,
        algorithm: JWT_ALGORITHM,
        // Phase 26 (2026-05-20) — audience pin parity with the login
        // + mfa-verify token; AdminAuthGuard requires this.
        audience: JWT_AUDIENCE_ADMIN,
      },
    );

    this.logger.log(`Admin session refreshed: ${admin.id}`);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: accessTtlSeconds,
      adminId: admin.id!,
      role: admin.role!,
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
