/**
 * RFC 7807 problem-type slugs. Each slug becomes a stable URI when
 * concatenated with `PROBLEM_DETAILS_BASE_URI` (default
 * `https://sportsmart.com/problems`). Clients dereference these to
 * learn what an error means without parsing free-text messages.
 *
 * Keep the slug set aligned with apps/api's
 * `core/filters/problem-types.ts` — partners and the apps/api
 * frontend already switch on those slugs, and the facade's wire
 * shape should be indistinguishable from apps/api's. New slugs go
 * here AND in the apps/api file in the same PR.
 */
export const PROBLEM_TYPES = {
  badRequest: 'bad-request',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  notFound: 'not-found',
  conflict: 'conflict',
  unprocessable: 'unprocessable-entity',
  rateLimited: 'rate-limited',
  notImplemented: 'not-implemented',
  internal: 'internal-error',
  badGateway: 'upstream-gateway-error',

  validation: 'validation-failed',

  // Logistics-specific (the apps/api equivalents land alongside any
  // domain types it grows for shipping).
  shipmentNotFound: 'shipment-not-found',
  awbNotFound: 'awb-not-found',
  returnNotFound: 'return-not-found',
  notServiceable: 'not-serviceable',
  webhookSignatureInvalid: 'webhook-signature-invalid',
  webhookReplay: 'webhook-replay',
  partnerDown: 'partner-down',
  invalidFsmTransition: 'invalid-fsm-transition',
} as const;

export type ProblemTypeSlug =
  (typeof PROBLEM_TYPES)[keyof typeof PROBLEM_TYPES];

export const PROBLEM_DETAILS_BASE_URI = 'https://sportsmart.com/problems';

export function problemTypeUri(slug: ProblemTypeSlug): string {
  const base = PROBLEM_DETAILS_BASE_URI.replace(/\/+$/, '');
  return `${base}/${slug}`;
}
