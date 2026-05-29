import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  JWT_ALGORITHM,
  JWT_AUDIENCE_ADMIN,
} from '../../../../core/auth/jwt-constants';
import { hashPassword, shouldRehash } from '../../../../core/auth/bcrypt-policy';
import { UnauthorizedAppException, ForbiddenAppException } from '../../../../core/exceptions';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

const DUMMY_HASH = '$2a$12$LJ3m4ys3Lg7VhMQdxlGC7.BQJ1HFpR9PQXHs1GKTTl1C5KVhJvtNi';
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

interface AdminLoginInput {
  email: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface AdminLoginSession {
  mfaRequired?: false;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  admin: {
    adminId: string;
    name: string;
    email: string;
    role: string;
  };
}

// Phase 10 (PR 10.6) — Discriminated union return type. When the
// admin has MFA enrolled (mfaEnabledAt != null) the use case stops
// after password verification and returns this challenge shape
// instead of a session. Caller posts the TOTP code + challengeToken
// to /admin/mfa/verify-challenge to obtain the session.
export interface AdminLoginMfaChallenge {
  mfaRequired: true;
  /**
   * Short-lived JWT (5min) carrying the adminId in `sub` and
   * `aud=admin-mfa-challenge`. Verified by the challenge endpoint
   * before TOTP verification. Audience claim prevents the
   * challenge token from being mis-used as a session token.
   */
  challengeToken: string;
  challengeExpiresIn: number;
  admin: {
    adminId: string;
    email: string;
  };
}

export type AdminLoginResult = AdminLoginSession | AdminLoginMfaChallenge;

export const ADMIN_MFA_CHALLENGE_AUD = 'admin-mfa-challenge';
const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;

@Injectable()
export class AdminLoginUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly envService: EnvService,
    private readonly logger: AppLoggerService,
    private readonly audit: AuditPublicFacade,
  ) {
    this.logger.setContext('AdminLoginUseCase');
  }

  /** Audit-log helper — best-effort, never blocks the login flow. */
  private auditLogin(
    actorId: string | undefined,
    actorRole: string | undefined,
    action:
      | 'ADMIN_LOGIN_SUCCESS'
      | 'ADMIN_LOGIN_FAILED'
      | 'ADMIN_LOGIN_BLOCKED'
      | 'ADMIN_LOGIN_MFA_CHALLENGE_ISSUED',
    metadata: Record<string, unknown>,
    ipAddress?: string,
    userAgent?: string,
  ): void {
    this.audit
      .writeAuditLog({
        actorId,
        actorRole,
        action,
        module: 'admin',
        resource: 'admin_session',
        resourceId: actorId,
        metadata,
        ipAddress,
        userAgent,
      })
      .catch((err) => {
        this.logger.error(`Audit write failed: ${(err as Error).message}`);
      });
  }

  async execute(input: AdminLoginInput): Promise<AdminLoginResult> {
    const { email, password, userAgent, ipAddress } = input;

    const admin = await this.adminRepo.findAdminByEmail(email);

    if (!admin) {
      await bcrypt.compare(password, DUMMY_HASH);
      // Audit unknown-email failures so brute-force attempts surface in logs.
      this.auditLogin(
        undefined,
        undefined,
        'ADMIN_LOGIN_FAILED',
        { reason: 'unknown_email', email },
        ipAddress,
        userAgent,
      );
      throw new UnauthorizedAppException('Invalid credentials');
    }

    if (admin.status !== 'ACTIVE') {
      this.auditLogin(
        admin.id,
        admin.role,
        'ADMIN_LOGIN_BLOCKED',
        { reason: 'inactive_account', status: admin.status },
        ipAddress,
        userAgent,
      );
      throw new ForbiddenAppException('Admin account is not active');
    }

    // Check lockout
    if (admin.lockUntil && admin.lockUntil > new Date()) {
      const remainingMinutes = Math.ceil((admin.lockUntil.getTime() - Date.now()) / 60000);
      this.auditLogin(
        admin.id,
        admin.role,
        'ADMIN_LOGIN_BLOCKED',
        { reason: 'locked', lockUntil: admin.lockUntil.toISOString() },
        ipAddress,
        userAgent,
      );
      throw new UnauthorizedAppException(
        `Account locked. Try again after ${remainingMinutes} minute(s).`,
      );
    }

    const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);

    if (!isPasswordValid) {
      const newAttempts = admin.failedLoginAttempts + 1;
      const updateData: Record<string, unknown> = { failedLoginAttempts: newAttempts };

      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        updateData.lockUntil = new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000);
      }

      await this.adminRepo.updateAdmin(admin.id, updateData);

      this.auditLogin(
        admin.id,
        admin.role,
        'ADMIN_LOGIN_FAILED',
        { reason: 'wrong_password', attempts: newAttempts },
        ipAddress,
        userAgent,
      );

      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        throw new UnauthorizedAppException(
          `Account locked due to too many failed attempts. Try again after ${LOCK_DURATION_MINUTES} minute(s).`,
        );
      }

      throw new UnauthorizedAppException('Invalid credentials');
    }

    // Password verified — reset the failure counter and lock window
    // up front so the next password attempt starts clean regardless
    // of whether MFA succeeds. (Failed MFA attempts get their own
    // counter in PR 10.7; for now, a wrong TOTP code doesn't lock
    // the account but also doesn't relock just because the password
    // succeeded.)
    await this.adminRepo.updateAdmin(admin.id, {
      failedLoginAttempts: 0,
      lockUntil: null,
    });

    // Phase 13 (2026-05-16) — opportunistic rehash. Done BEFORE the
    // MFA branch so an admin who's enrolled MFA but logged in last
    // before the cost bump still gets their hash upgraded; MFA
    // happens after this point and the new hash is already persisted.
    if (shouldRehash(admin.passwordHash)) {
      try {
        const upgraded = await hashPassword(password);
        await this.adminRepo.updateAdmin(admin.id, { passwordHash: upgraded });
      } catch (err) {
        this.logger.warn(
          `Failed to rehash admin ${admin.id} on login: ${(err as Error).message}`,
          'AdminLoginUseCase',
        );
      }
    }

    // Phase 10 (PR 10.6) — MFA challenge branch. If the admin has
    // enrolled MFA, pause here: issue a short-lived challenge token
    // and return the challenge shape. The caller posts the
    // challengeToken + TOTP code to /admin/mfa/verify-challenge to
    // obtain the actual session. lastLoginAt is intentionally NOT
    // set yet — the audit signal is "login completed", which a
    // password-only halt doesn't qualify as.
    const mfaState = await this.adminRepo.findAdminById(admin.id, {
      mfaEnabledAt: true,
    });

    // Phase 23 (2026-05-20) — Force MFA for SUPER_ADMIN.
    //
    // Pre-Phase-23 a SUPER_ADMIN who hadn't enrolled MFA could log in
    // with just a password — defeating the point of MFA infrastructure
    // for the most privileged role. Now: SUPER_ADMIN without MFA
    // enrolled is hard-blocked at login with a clear ENFORCED_MFA
    // code. The frontend surfaces a "you must enroll MFA before
    // logging in" screen and walks the admin through the existing
    // enrollment flow (which is itself gated behind an authenticated
    // session, so we keep one well-defined path: an out-of-band
    // recovery / break-glass route for the bootstrap super-admin's
    // first login lives in the runbook).
    if (admin.role === 'SUPER_ADMIN' && !mfaState?.mfaEnabledAt) {
      this.auditLogin(
        admin.id,
        admin.role,
        'ADMIN_LOGIN_BLOCKED',
        { reason: 'enforced_mfa_enrollment_required' },
        ipAddress,
        userAgent,
      );
      throw new ForbiddenAppException(
        'Your SUPER_ADMIN account must have MFA enrolled before you can sign in. Contact your security operator for the enrollment runbook.',
        'ENFORCED_MFA_ENROLLMENT',
      );
    }

    if (mfaState?.mfaEnabledAt) {
      // Phase 26 (2026-05-20) — JTI for one-time use. Pre-Phase-26 the
      // challenge token was stateless: a captured challenge + a fresh
      // TOTP code captured during the 5-min window could be replayed,
      // though the same-step anti-replay caught most cases. JTI makes
      // the challenge single-use: the verify path consumes the JTI via
      // Redis SET NX EX so a second presentation of the same token is
      // 401'd even before the TOTP step is evaluated.
      const jti = randomUUID();
      const challengeToken = jwt.sign(
        {
          sub: admin.id,
          email: admin.email,
          aud: ADMIN_MFA_CHALLENGE_AUD,
          jti,
        },
        this.envService.getString('JWT_ADMIN_SECRET'),
        {
          expiresIn: MFA_CHALLENGE_TTL_SECONDS,
          algorithm: JWT_ALGORITHM,
        },
      );

      this.auditLogin(
        admin.id,
        admin.role,
        'ADMIN_LOGIN_MFA_CHALLENGE_ISSUED',
        {},
        ipAddress,
        userAgent,
      );

      return {
        mfaRequired: true,
        challengeToken,
        challengeExpiresIn: MFA_CHALLENGE_TTL_SECONDS,
        admin: { adminId: admin.id, email: admin.email },
      };
    }

    // Successful login (no MFA enrolled)
    await this.adminRepo.updateAdmin(admin.id, {
      lastLoginAt: new Date(),
    });

    // Create session
    const refreshToken = randomUUID();
    const refreshTtl = this.parseTimeToMs(this.envService.getString('JWT_REFRESH_TTL', '30d'));

    const session = await this.adminRepo.createAdminSession({
      adminId: admin.id,
      refreshToken,
      userAgent: userAgent || null,
      ipAddress: ipAddress || null,
      expiresAt: new Date(Date.now() + refreshTtl),
    });

    // Generate access token
    //
    // Phase 23 (2026-05-20) — fallback tightened from '7d' → '15m'.
    // The env schema's `.default('1h')` makes the literal fallback
    // unreachable in normal boot, but defense-in-depth: if anyone
    // ever removes the schema default a 15-minute token is the
    // failure mode we want, not a 7-day one.
    const accessTtl = this.envService.getString('JWT_ACCESS_TTL', '15m');
    const accessTtlSeconds = Math.floor(this.parseTimeToMs(accessTtl) / 1000);

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
        // Phase 26 (2026-05-20) — pin audience so the AdminAuthGuard
        // can reject the challenge token (aud=admin-mfa-challenge)
        // explicitly rather than relying on missing claims.
        audience: JWT_AUDIENCE_ADMIN,
      },
    );

    this.logger.log(`Admin logged in: ${admin.id} (${admin.role})`);

    this.auditLogin(
      admin.id,
      admin.role,
      'ADMIN_LOGIN_SUCCESS',
      { sessionId: session.id },
      ipAddress,
      userAgent,
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtlSeconds,
      admin: {
        adminId: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    };
  }

  private parseTimeToMs(time: string): number {
    const match = time.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 30 * 24 * 60 * 60 * 1000;
    const value = parseInt(match[1]!, 10);
    const unit = match[2]!;
    const multipliers: Record<string, number> = {
      s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000,
    };
    return value * (multipliers[unit] || 1000);
  }
}
