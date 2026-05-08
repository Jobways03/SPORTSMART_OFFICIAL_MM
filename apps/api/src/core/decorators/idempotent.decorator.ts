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
 */
export const IDEMPOTENT_KEY = 'idempotent';
export const Idempotent = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IDEMPOTENT_KEY, true);
