import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { TooManyRequestsAppException } from '../../../../core/exceptions';

/**
 * Phase 17 (2026-05-20) — per-email brute-force counter.
 *
 * The existing protections cover the easy half of the threat model:
 *
 *   • `@Throttle({ default: { limit: 5, ttl: 60_000 } })` — per-IP
 *     burst limit. Stops a single-IP brute-force.
 *   • `User.failedLoginAttempts` + `lockUntil` — per-account hard
 *     lock after 5 wrong passwords. Stops an attacker once the
 *     correct email is known.
 *
 * What neither covers: credential stuffing across MANY emails from
 * many rotating IPs. A botnet armed with a leaked credential dump
 * can probe one email per IP, never tripping the per-IP throttle
 * AND never tripping the per-account lockout (each account sees only
 * one or two attempts before the bot moves on).
 *
 * This service adds a third layer: a sliding-window counter keyed on
 * the normalized email address. Every failed login bumps the counter;
 * when it crosses the threshold the email is "soft-locked" for the
 * remainder of the window — every login attempt against that address
 * returns 429 with Retry-After regardless of the credentials and
 * regardless of source IP.
 *
 * The store is Redis with an EXPIRE-set window so the counter
 * naturally decays without a cleanup job. If Redis is unavailable
 * the service degrades open (rather than denying every login) and
 * logs a warning — the per-IP throttle and per-account lockout still
 * cover the common case.
 */
@Injectable()
export class EmailBruteForceService {
  /** Counter window in seconds. After this many seconds with no
   * activity the soft-lock resets. Default 15 minutes mirrors the
   * per-account lockout duration. */
  private static readonly WINDOW_SECONDS = 15 * 60;

  /** Failed-attempt threshold within the window before the email is
   * soft-locked. 10 is permissive enough to absorb typos and
   * fat-finger keyboard fumbles without false-positives, but tight
   * enough to catch a real credential-stuffing run. */
  private static readonly THRESHOLD = 10;

  /** Soft-lock duration (seconds) once the threshold is crossed. We
   * could compute "time remaining in window" but a flat 15 minutes
   * is easier to communicate via Retry-After. */
  private static readonly SOFT_LOCK_SECONDS = 15 * 60;

  constructor(
    private readonly redis: RedisService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('EmailBruteForceService');
  }

  private counterKey(email: string): string {
    return `auth:login:email-failed:${this.normalize(email)}`;
  }

  private lockKey(email: string): string {
    return `auth:login:email-locked:${this.normalize(email)}`;
  }

  private normalize(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Called at the top of the login pipeline. If the email is
   * soft-locked, throws 429 with Retry-After hint.
   */
  async assertNotLocked(email: string): Promise<void> {
    try {
      const ttl = await this.redis.getClient().ttl(this.lockKey(email));
      // Redis returns -2 (no key) or -1 (no expiry, won't happen for our writes).
      // Treat anything >= 0 as "locked, with N seconds remaining."
      if (ttl > 0) {
        throw new TooManyRequestsAppException(
          `Too many failed sign-in attempts for this email. Try again in ${Math.ceil(
            ttl / 60,
          )} minute(s).`,
        );
      }
    } catch (err) {
      if (err instanceof TooManyRequestsAppException) throw err;
      // Redis unavailable — degrade open. The per-IP throttle and
      // per-account lockout still guard the request.
      this.logger.warn(
        `EmailBruteForceService.assertNotLocked: Redis unreachable, degrading open. ${(err as Error)?.message ?? ''}`,
      );
    }
  }

  /**
   * Bump the counter for this email. If the counter crosses the
   * threshold, write the soft-lock key with a TTL. Best-effort —
   * Redis failures here must not block the login response.
   */
  async recordFailure(email: string): Promise<void> {
    try {
      const client = this.redis.getClient();
      const k = this.counterKey(email);
      const count = await client.incr(k);
      if (count === 1) {
        await client.expire(k, EmailBruteForceService.WINDOW_SECONDS);
      }
      if (count >= EmailBruteForceService.THRESHOLD) {
        await client.set(
          this.lockKey(email),
          '1',
          'EX',
          EmailBruteForceService.SOFT_LOCK_SECONDS,
        );
        this.logger.warn(
          `Email soft-locked after ${count} failed login attempts: ${this.normalize(email)}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `EmailBruteForceService.recordFailure: Redis unreachable, attempt not counted. ${(err as Error)?.message ?? ''}`,
      );
    }
  }

  /**
   * Reset the counter + clear the soft-lock after a successful
   * authentication. Best-effort.
   */
  async clear(email: string): Promise<void> {
    try {
      const client = this.redis.getClient();
      await Promise.all([
        client.del(this.counterKey(email)),
        client.del(this.lockKey(email)),
      ]);
    } catch {
      // Best-effort
    }
  }
}
