import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  JWT_ALGORITHM,
  JWT_AUDIENCE_CUSTOMER,
} from '../../../../core/auth/jwt-constants';
import { hashPassword, shouldRehash } from '../../../../core/auth/bcrypt-policy';
import {
  ForbiddenAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import { LoginResponseData } from '../../presentation/dtos/auth-response.dto';
import { EmailBruteForceService } from '../services/email-brute-force.service';
import {
  UserRepository,
  USER_REPOSITORY,
} from '../../domain/repositories/user.repository';
import {
  SessionRepository,
  SESSION_REPOSITORY,
} from '../../domain/repositories/session.repository';

/**
 * Pre-hashed dummy password used to keep timing constant when the
 * email lookup misses. The cost must match the production bcrypt
 * cost so the dummy-compare and the real-compare take the same time.
 */
const DUMMY_HASH = '$2a$12$LJ3m4ys3Lg7VhMQdxlGC7.BQJ1HFpR9PQXHs1GKTTl1C5KVhJvtNi';
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

interface LoginInput {
  email: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Phase 17 (2026-05-20) — Customer login use case.
 *
 * Pipeline (in order):
 *   1. Look up user (or run dummy bcrypt + 401 on miss — timing parity).
 *   2. status==='PENDING_VERIFICATION' → 403 EMAIL_NOT_VERIFIED (allows
 *      a resend-OTP CTA on the frontend; this is the one deliberate
 *      enumeration exception, because the rest of the registration
 *      flow already discloses email-existence).
 *   3. emailVerified===false → 403 EMAIL_NOT_VERIFIED (legacy rows
 *      pre-Phase-16 with ACTIVE+emailVerified=false fall here).
 *   4. status!=='ACTIVE' (SUSPENDED/BANNED/INACTIVE) → uniform 401
 *      "Invalid email or password". Does NOT reveal account state.
 *   5. lockUntil in the future → 401 with retry hint.
 *   6. bcrypt compare; on miss, atomic-increment failedLoginAttempts
 *      + bump per-email brute-force counter.
 *   7. On success: clear lockout, bump lastLoginAt, mint session +
 *      hashed refresh token, sign access JWT with iss+aud+sessionId.
 */
@Injectable()
export class LoginUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    @Inject(SESSION_REPOSITORY)
    private readonly sessionRepo: SessionRepository,
    private readonly envService: EnvService,
    private readonly eventBus: EventBusService,
    private readonly emailBruteForce: EmailBruteForceService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('LoginUserUseCase');
  }

  async execute(input: LoginInput): Promise<LoginResponseData> {
    const { email, password, userAgent, ipAddress } = input;

    // Per-email soft-lock — fires for credential-stuffing patterns
    // that the per-IP throttle and per-account lockout both miss
    // (one attempt per IP across many emails).
    await this.emailBruteForce.assertNotLocked(email);

    const user = await this.userRepo.findByEmailWithRoles(email);

    if (!user) {
      // Timing-attack defence: still run a bcrypt against a known
      // hash so the "no such email" branch takes the same time as
      // the "wrong password" branch. Best-effort — never throw from
      // the dummy compare.
      try { await bcrypt.compare(password, DUMMY_HASH); } catch { /* noop */ }
      // Still count the failure in the per-email counter so a
      // bot probing many emails from one IP gets soft-locked too.
      await this.emailBruteForce.recordFailure(email);
      throw new UnauthorizedAppException('Invalid email or password');
    }

    // 1) PENDING_VERIFICATION → explicit EMAIL_NOT_VERIFIED so the
    //    frontend can surface "Verify your email / resend code."
    if (user.status === 'PENDING_VERIFICATION') {
      throw new ForbiddenAppException(
        'Your email is not verified. Please check your inbox or request a new verification code.',
        'EMAIL_NOT_VERIFIED',
      );
    }

    // 2) emailVerified false (legacy ACTIVE rows) → same code, same UX.
    const emailVerified = (user as unknown as { emailVerified?: boolean })
      .emailVerified;
    if (emailVerified === false) {
      throw new ForbiddenAppException(
        'Your email is not verified. Please check your inbox or request a new verification code.',
        'EMAIL_NOT_VERIFIED',
      );
    }

    // 3) Any other non-ACTIVE state (SUSPENDED, BANNED, INACTIVE)
    //    returns the SAME 401 as a wrong password — never leak the
    //    moderation state of an account publicly.
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedAppException('Invalid email or password');
    }

    // Lockout window: surface a friendly retry hint. This message
    // discloses that the email exists, but it can only be triggered
    // by a real attacker who has already made 5 wrong guesses against
    // this exact email — the soft-lock above and the per-IP throttle
    // both fire first for blind probing.
    if (user.lockUntil && user.lockUntil > new Date()) {
      const remainingMinutes = Math.ceil(
        (user.lockUntil.getTime() - Date.now()) / 60_000,
      );
      throw new UnauthorizedAppException(
        `Account locked. Try again after ${remainingMinutes} minute(s).`,
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      // Atomic increment + maybe-stamp lockUntil. The previous
      // read-then-set lost increments under concurrency (two parallel
      // wrong passwords both wrote N+1 instead of N+2).
      const after = await this.userRepo.recordFailedLoginAtomic(
        user.id,
        MAX_FAILED_ATTEMPTS,
        LOCK_DURATION_MINUTES * 60 * 1000,
      );
      await this.emailBruteForce.recordFailure(email);
      if (after.lockUntil) {
        throw new UnauthorizedAppException(
          `Account locked due to too many failed attempts. Try again after ${LOCK_DURATION_MINUTES} minute(s).`,
        );
      }
      throw new UnauthorizedAppException('Invalid email or password');
    }

    // Successful password check — clear lockout counters so a user
    // who nearly triggered a lockout doesn't carry the counter
    // forward. Best-effort writes downstream must not block login.
    if (user.failedLoginAttempts > 0 || user.lockUntil) {
      await this.userRepo.clearLoginLockout(user.id);
    }
    await this.emailBruteForce.clear(email);
    this.userRepo
      .touchLastLogin(user.id)
      .catch((err) =>
        this.logger.warn(`Failed to touch lastLoginAt for ${user.id}: ${err}`),
      );

    // Phase 13 (2026-05-16) — opportunistic rehash. Legacy hashes
    // stored at a cost below the current target get re-hashed and
    // persisted silently on the user's next successful sign-in.
    // Best-effort: failures here don't block login.
    if (shouldRehash(user.passwordHash)) {
      try {
        const upgraded = await hashPassword(password);
        await this.userRepo.updatePassword(user.id, upgraded);
      } catch (err) {
        this.logger.warn(
          `Failed to rehash user ${user.id} on login: ${(err as Error).message}`,
          'LoginUserUseCase',
        );
      }
    }

    const roles = user.roleAssignments.map((ra) => ra.role.name);

    // Mint session row — refresh token is the raw UUID returned to
    // the client; the repository stores the SHA-256 hash so a DB
    // leak does NOT yield live tokens.
    const refreshToken = randomUUID();
    const refreshTtl = this.parseTimeToMs(
      this.envService.getString('JWT_REFRESH_TTL', '30d'),
    );
    const expiresAt = new Date(Date.now() + refreshTtl);

    const session = await this.sessionRepo.createSession({
      userId: user.id,
      refreshToken,
      userAgent: this.truncate(userAgent ?? null, 512),
      ipAddress: this.truncate(ipAddress ?? null, 45), // IPv6 max length is 45
      expiresAt,
    });

    // Phase 17 (2026-05-20) — access TTL default tightened from 7d
    // to 15m. A stolen access token is now valid for at most 15
    // minutes; refresh rotation issues a fresh token within that
    // window for live sessions.
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

    this.eventBus
      .publish({
        eventName: 'identity.user.logged_in',
        aggregate: 'user',
        aggregateId: user.id,
        occurredAt: new Date(),
        payload: { userId: user.id, sessionId: session.id },
      })
      .catch((err) => {
        this.logger.error(`Failed to publish login event: ${err}`);
      });

    this.logger.log(`User logged in: ${user.id}`);

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtlSeconds,
      // Phase 17 (2026-05-20) — `roles` removed from the response.
      // The storefront never read it; the JWT carries the claim for
      // server-side checks; client-side gating cannot trust a
      // self-reported role anyway.
      user: {
        userId: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }

  private truncate(value: string | null, max: number): string | null {
    if (value === null) return null;
    return value.length > max ? value.slice(0, max) : value;
  }

  private parseTimeToMs(time: string): number {
    const match = time.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 30 * 24 * 60 * 60 * 1000; // default 30 days
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
