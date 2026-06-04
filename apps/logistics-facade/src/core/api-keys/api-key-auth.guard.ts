import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { EnvService } from '../../bootstrap/env/env.service';

/**
 * M0 API-key guard. Accepts `Authorization: ApiKey <token>` and
 * compares against INTERNAL_API_KEY with a constant-time check.
 *
 * Shape modelled on apps/api/src/core/api-keys/api-key-auth.guard.ts;
 * the apps/api guard verifies hashed keys against a DB-backed
 * ApiKey table and enforces per-key rate limits + scopes. M0 is
 * intentionally simpler — one shared secret, one binary decision.
 *
 * Migration path to per-caller keys (M1):
 *   1. Add an ApiKey model to prisma/schema (mirror apps/api's shape).
 *   2. Hash incoming tokens (argon2id / sha256), look up by hash.
 *   3. Attach the resolved key onto `req.apiKey` for downstream scope
 *      checks.
 *   4. Add a rate limiter keyed by apiKeyId, mirroring apps/api's
 *      ApiKeyRateLimiter.
 *
 * Failure mode: throws UnauthorizedException with a stable message
 * so the RFC 7807 filter can map to the `unauthorized` problem type.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyAuthGuard.name);

  constructor(private readonly env: EnvService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers?.authorization;

    if (typeof header !== 'string' || header.length === 0) {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const match = header.match(/^ApiKey\s+(.+)$/i);
    if (!match) {
      throw new UnauthorizedException(
        'Authorization header must use the `ApiKey <token>` scheme',
      );
    }

    const supplied = match[1]!.trim();
    const expected = this.env.getString('INTERNAL_API_KEY');

    if (!this.constantTimeEquals(supplied, expected)) {
      // Log the attempt at warn level — repeated 401s on this surface
      // are an exfil signal that ops dashboards watch for.
      this.logger.warn(
        `Rejected ApiKey from ${req.ip ?? 'unknown-ip'} on ${req.method} ${req.originalUrl}`,
      );
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }

  /**
   * Constant-time string equality. timingSafeEqual requires equal-
   * length buffers, so we left-pad the shorter side to avoid early-
   * exit length leakage. Falls back to `false` on any length mismatch
   * AFTER the comparison so the leaf-of-time decision stays uniform.
   */
  private constantTimeEquals(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) {
      // Still perform a same-length compare so the wall-clock cost
      // doesn't reveal whether the length matched.
      const padded = Buffer.alloc(Math.max(aBuf.length, bBuf.length));
      timingSafeEqual(padded, padded);
      return false;
    }
    return timingSafeEqual(aBuf, bBuf);
  }
}
