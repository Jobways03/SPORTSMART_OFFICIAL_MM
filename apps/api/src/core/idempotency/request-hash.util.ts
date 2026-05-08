import { createHash } from 'crypto';
import type { Request } from 'express';

/**
 * Compute a stable hash of an incoming request used to detect "same
 * idempotency key + different body" replays. Industry references:
 *   - https://stripe.com/docs/api/idempotent_requests
 *   - https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header
 *
 * Includes:
 *   - HTTP method (POST vs PATCH must not collide)
 *   - Route path (the templated one if available, else url)
 *   - Body (sorted JSON for stable serialization across key order)
 *
 * Excludes:
 *   - Query params (they're already in the URL for our routes)
 *   - Headers (a retried request may have a different correlation id;
 *     header diffs are not semantically meaningful here)
 *   - File uploads — those streams aren't replayable anyway, the
 *     interceptor short-circuits multipart routes
 */
export function computeRequestHash(req: Request): string {
  const method = (req.method ?? '').toUpperCase();
  // route?.path is the templated form (`/customer/returns/:id/cancel`)
  // when available — preferred over `req.path` because the latter
  // contains the resolved path and would treat `/abc/cancel` and
  // `/xyz/cancel` as different bodies even if both call same handler.
  const routePath: string =
    (req as { route?: { path?: string } }).route?.path ??
    req.path ??
    '';
  const body = stableStringify(req.body ?? {});
  return createHash('sha256')
    .update(method)
    .update('|')
    .update(routePath)
    .update('|')
    .update(body)
    .digest('hex');
}

/**
 * JSON stringify with deterministic key ordering. Two semantically
 * equivalent objects produce identical strings regardless of how
 * the client serialized them.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) =>
      JSON.stringify(k) +
      ':' +
      stableStringify((value as Record<string, unknown>)[k]),
  );
  return '{' + parts.join(',') + '}';
}

/**
 * Extract the actor identity that the auth guard already attached to
 * req. Falls back to ANONYMOUS — currently unused (every idempotent
 * route is gated by an auth guard) but kept as a safety net so a
 * future public-API route doesn't crash on missing actor.
 */
export function extractActor(req: Request): { type: string; id: string } {
  const r = req as unknown as Record<string, unknown>;
  if (typeof r.adminId === 'string') return { type: 'ADMIN', id: r.adminId };
  if (typeof r.sellerId === 'string') return { type: 'SELLER', id: r.sellerId };
  if (typeof r.franchiseId === 'string')
    return { type: 'FRANCHISE', id: r.franchiseId };
  if (typeof r.affiliateId === 'string')
    return { type: 'AFFILIATE', id: r.affiliateId };
  if (typeof r.userId === 'string') return { type: 'CUSTOMER', id: r.userId };
  return { type: 'ANONYMOUS', id: '-' };
}
