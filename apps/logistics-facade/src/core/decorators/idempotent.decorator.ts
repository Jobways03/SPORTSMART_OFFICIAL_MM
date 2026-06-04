import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route handler as idempotent. Clients calling such an endpoint
 * MUST send an `X-Idempotency-Key` header (8–128 chars). A future
 * interceptor (M1) deduplicates on this key against the
 * IdempotencyKey table — replays return the cached response, and a
 * key reused with a different request body is rejected with 409.
 *
 * M0 ships the decorator AND the Prisma table but NOT the interceptor.
 * Routes carry the marker so the M1 PR can flip the interceptor on
 * without touching every controller. The behaviour at flag-off is
 * "pass through" — exactly today's behaviour.
 *
 * Use on POST / PATCH endpoints whose effects are state-changing AND
 * external-facing AND whose duplication would be operationally
 * expensive (double-booking a courier, double-issuing an RTO). Read
 * endpoints don't need this — they're naturally idempotent.
 *
 * Mirrors apps/api/src/core/decorators/idempotent.decorator.ts.
 */
export const IDEMPOTENT_KEY = 'idempotent';
export const Idempotent = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IDEMPOTENT_KEY, true);
