import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route handler as idempotent. Clients calling such an endpoint
 * MUST send an `X-Idempotency-Key` header (8-128 chars). The interceptor
 * deduplicates on this key — replays return the cached response, and a
 * key reused with a different request body is rejected with 409.
 *
 * Use on POST / PATCH endpoints whose effects are state-changing AND
 * external-facing AND whose duplication would be operationally expensive
 * (extra returns, double refunds, duplicate disputes). Read endpoints
 * don't need this — they're naturally idempotent.
 *
 * Default behaviour at flag-OFF (`IDEMPOTENCY_ENABLED=false`): the
 * interceptor short-circuits, the header is ignored, and the route
 * behaves exactly as today. This lets us roll the feature in stages.
 *
 * Phase 95 (2026-05-23) — Phase 93 deferred #17 closure. Optional
 * `{ ttl }` override (in seconds) so route-specific deduplication
 * windows are possible without nudging the platform-wide
 * `IDEMPOTENCY_TTL_HOURS` env. Use sparingly — long-lived keys are a
 * memory/storage tradeoff. Omit the arg to inherit the env default
 * (24h).
 */
export const IDEMPOTENT_KEY = 'idempotent';
export const IDEMPOTENT_TTL_KEY = 'idempotent:ttl-seconds';

export interface IdempotentOptions {
  /** Override the dedup window (seconds). Falls back to env default. */
  ttl?: number;
}

export function Idempotent(
  options?: IdempotentOptions,
): MethodDecorator & ClassDecorator {
  return (target: any, key?: any, descriptor?: any) => {
    SetMetadata(IDEMPOTENT_KEY, true)(target, key, descriptor);
    if (typeof options?.ttl === 'number' && options.ttl > 0) {
      SetMetadata(IDEMPOTENT_TTL_KEY, options.ttl)(target, key, descriptor);
    }
    return descriptor ?? target;
  };
}
