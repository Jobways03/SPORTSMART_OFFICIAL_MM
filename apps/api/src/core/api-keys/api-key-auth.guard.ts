import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  ForbiddenAppException,
  TooManyRequestsAppException,
  UnauthorizedAppException,
} from '../exceptions';
import { EnvService } from '../../bootstrap/env/env.service';
import { ApiKeyService } from './api-key.service';
import { ApiKeyRateLimiter } from './api-key-rate-limiter.service';

/**
 * Phase 10 (PR 10.1) — Bearer-token guard for the public REST API.
 *
 * Order:
 *   1. Extract bearer from `Authorization: Bearer sk_…`
 *   2. Verify hash → key row.
 *   3. Rate-limit per key.
 *   4. Stash the verified key on req for downstream scope checks.
 *
 * Step 4 is intentional: the scope decorator (separate, similar to
 * @Permissions for admins) reads the key off the request rather than
 * re-doing the verify. Reduces DB hits on every public endpoint.
 *
 * Usage stamping (what method/path/status they hit) happens in a
 * response interceptor that fires after the handler — see the
 * MetricsModule pattern.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyAuthGuard.name);

  constructor(
    private readonly env: EnvService,
    private readonly keys: ApiKeyService,
    private readonly limiter: ApiKeyRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const auth: string | undefined = req.headers?.authorization;
    const token = auth?.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      throw new UnauthorizedAppException('Missing API key');
    }

    const verified = await this.keys.verify(token);
    if (!verified) {
      throw new UnauthorizedAppException('Invalid or revoked API key');
    }

    const rate =
      verified.rateLimitPerMinute ??
      this.env.getNumber('API_DEFAULT_RATE_PER_MINUTE', 60);
    const decision = this.limiter.consume(verified.id, rate);
    if (!decision.allowed) {
      // Honour the standard Retry-After response header so clients
      // can back off intelligently. Express response is on req.res.
      try {
        req.res.setHeader('Retry-After', String(decision.retryAfterSeconds));
      } catch {
        // ignore — header is informational
      }
      throw new TooManyRequestsAppException(
        `Rate limit exceeded. Retry after ${decision.retryAfterSeconds}s.`,
      );
    }

    req.apiKey = verified;
    req.apiKeyId = verified.id;
    return true;
  }
}

/**
 * Defensive helper for callers that want to enforce a specific scope
 * inside their handler (rather than via a decorator):
 *   if (!apiKeyHasScope(req.apiKey, 'orders:read')) throw …
 */
export function apiKeyHasScope(
  key: { scopes: string[] } | undefined,
  scope: string,
): boolean {
  if (!key) return false;
  return key.scopes.includes(scope) || key.scopes.includes('*');
}

/**
 * Throws ForbiddenAppException if the key on `req` doesn't carry the
 * requested scope. Intended for use inside handlers that want
 * fine-grained scope checks without the decorator overhead.
 */
export function assertApiKeyScope(req: any, scope: string): void {
  if (!apiKeyHasScope(req.apiKey, scope)) {
    throw new ForbiddenAppException(`API key missing scope "${scope}"`);
  }
}
