import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { JWT_ALGORITHM } from '../../../../core/auth/jwt-constants';
import { hashPassword, shouldRehash } from '../../../../core/auth/bcrypt-policy';
import { hashRefreshToken } from '../../../../core/auth/refresh-token';
import {
  ForbiddenAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';

// Pre-hashed dummy hash so an unknown email doesn't short-circuit
// faster than a wrong password (timing-attack mitigation).
const DUMMY_HASH = '$2a$12$LJ3m4ys3Lg7VhMQdxlGC7.BQJ1HFpR9PQXHs1GKTTl1C5KVhJvtNi';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

@Injectable()
export class AffiliateAuthService {
  private readonly logger = new Logger(AffiliateAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly envService: EnvService,
    private readonly eventBus: EventBusService,
  ) {}

  async login(input: {
    email: string;
    password: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const email = input.email.trim().toLowerCase();

    const affiliate = await this.prisma.affiliate.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        passwordHash: true,
        status: true,
        failedLoginAttempts: true,
        lockUntil: true,
      },
    });

    if (!affiliate) {
      // Constant-time fall-through to thwart account enumeration.
      await bcrypt.compare(input.password, DUMMY_HASH);
      throw new UnauthorizedAppException('Invalid credentials');
    }

    if (affiliate.lockUntil && affiliate.lockUntil > new Date()) {
      throw new ForbiddenAppException(
        'Account temporarily locked due to too many failed attempts. Try again later.',
      );
    }

    // Phase 22 (2026-05-20) — Status gate.
    //
    // Audit-driven policy reversal: PENDING_APPROVAL no longer logs in.
    // The previous behaviour ("PENDING can sign in to see their
    // application status") contradicted the documented business rule
    // and let any registered applicant reach /dashboard, /dashboard/kyc,
    // and the referral-link generator before admin review.
    //
    // Allowed:  ACTIVE, INACTIVE (INACTIVE = read-only — they can see
    //           balance, access support; commission-earning is gated
    //           at attribution time).
    // Blocked:  PENDING_APPROVAL, REJECTED, SUSPENDED.
    if (
      ['PENDING_APPROVAL', 'REJECTED', 'SUSPENDED'].includes(affiliate.status)
    ) {
      const code =
        affiliate.status === 'PENDING_APPROVAL'
          ? 'AFFILIATE_PENDING_APPROVAL'
          : affiliate.status === 'REJECTED'
            ? 'AFFILIATE_REJECTED'
            : 'AFFILIATE_SUSPENDED';
      const message =
        affiliate.status === 'PENDING_APPROVAL'
          ? 'Your affiliate application is under review. We will email you once a decision is made.'
          : 'Your affiliate account is no longer active. Please contact support.';
      throw new ForbiddenAppException(message, code);
    }

    const ok = await bcrypt.compare(input.password, affiliate.passwordHash);
    if (!ok) {
      // Phase 22 (2026-05-20) — atomic increment. Pre-Phase-22 used a
      // read-then-write that two concurrent failed logins could clobber,
      // making the lockout miss legitimate brute-force attempts. Prisma's
      // `increment: 1` is an atomic SQL UPDATE, and the post-increment
      // counter is returned so we can stamp lockUntil deterministically.
      const updated = await this.prisma.affiliate.update({
        where: { id: affiliate.id },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true },
      });
      if (updated.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
        await this.prisma.affiliate.update({
          where: { id: affiliate.id },
          data: {
            lockUntil: new Date(
              Date.now() + LOCK_DURATION_MINUTES * 60_000,
            ),
          },
        });
        this.eventBus
          .publish({
            eventName: 'affiliate.account_locked',
            aggregate: 'affiliate',
            aggregateId: affiliate.id,
            occurredAt: new Date(),
            payload: {
              affiliateId: affiliate.id,
              email: affiliate.email,
              lockMinutes: LOCK_DURATION_MINUTES,
            },
          })
          .catch(() => undefined);
      }
      throw new UnauthorizedAppException('Invalid credentials');
    }

    // Reset counter on success.
    if (affiliate.failedLoginAttempts > 0 || affiliate.lockUntil) {
      await this.prisma.affiliate.update({
        where: { id: affiliate.id },
        data: { failedLoginAttempts: 0, lockUntil: null },
      });
    }

    // Phase 13 (2026-05-16) — opportunistic rehash. Legacy hashes
    // stored at the pre-Phase-13 cost of 10 get re-hashed at the
    // current target (12) on the user's next successful sign-in.
    if (shouldRehash(affiliate.passwordHash)) {
      try {
        const upgraded = await hashPassword(input.password);
        await this.prisma.affiliate.update({
          where: { id: affiliate.id },
          data: { passwordHash: upgraded },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to rehash affiliate ${affiliate.id} on login: ${(err as Error).message}`,
        );
      }
    }

    const accessTtlSeconds = 60 * 60; // 1h
    const refreshTtlMs = 30 * 24 * 60 * 60 * 1000; // 30d
    const refreshToken = randomUUID();

    const session = await this.prisma.affiliateSession.create({
      data: {
        affiliateId: affiliate.id,
        refreshToken: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtlMs),
        userAgent: input.userAgent?.slice(0, 512) ?? null,
        ipAddress: input.ipAddress?.slice(0, 45) ?? null,
      },
      select: { id: true },
    });

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

    this.eventBus
      .publish({
        eventName: 'affiliate.logged_in',
        aggregate: 'affiliate',
        aggregateId: affiliate.id,
        occurredAt: new Date(),
        payload: { affiliateId: affiliate.id, sessionId: session.id },
      })
      .catch(() => undefined);

    // Phase 22 (2026-05-20) — Legacy `token` field dropped. Returning
    // both `token` and `accessToken` (same value, kept for "backwards
    // compat") was tech debt — new code may use the wrong field, and
    // the storefront-affiliate UI's `data.token` reader was the only
    // remaining consumer. Updated frontend (Phase 22) reads
    // `data.accessToken`. New shape: just accessToken + refreshToken.
    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtlSeconds,
      affiliate: {
        id: affiliate.id,
        email: affiliate.email,
        firstName: affiliate.firstName,
        lastName: affiliate.lastName,
        status: affiliate.status,
      },
    };
  }
}
