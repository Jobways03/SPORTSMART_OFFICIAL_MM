/**
 * RFC 7807 problem-type slugs. Each slug becomes a stable URI when
 * concatenated with PROBLEM_DETAILS_BASE_URI. Clients dereference these
 * to learn what an error means without parsing free-text messages.
 *
 * Add a new slug here whenever you create a new domain error class so
 * the filter can map it. Slugs follow kebab-case and stay stable across
 * the API's lifetime — once a partner has hard-coded a switch on a
 * slug, renaming it is a breaking change.
 */
export const PROBLEM_TYPES = {
  // Generic by HTTP code — used when a more specific type isn't applicable.
  badRequest: 'bad-request',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  notFound: 'not-found',
  conflict: 'conflict',
  unprocessable: 'unprocessable-entity',
  rateLimited: 'rate-limited',
  internal: 'internal-error',
  badGateway: 'upstream-gateway-error',

  // Validation: thrown by class-validator via the global pipe.
  validation: 'validation-failed',

  // Idempotency (Phase 1.1).
  idempotencyKeyMissing: 'idempotency-key-missing',
  idempotencyKeyInvalid: 'idempotency-key-invalid',
  idempotencyKeyConflict: 'idempotency-key-conflict',
  idempotencyKeyInFlight: 'idempotency-key-in-flight',

  // Returns / refunds — populated as later phases add their errors.
  returnWindowExpired: 'return-window-expired',
  returnAlreadyRequested: 'return-already-requested',
  returnNotEligible: 'return-not-eligible',
  forfeitConsentRequired: 'forfeit-consent-required',
  evidenceRequired: 'evidence-required',

  // Business duplicate (Phase 1.5).
  duplicateCase: 'duplicate-case',

  // Disputes.
  disputeAlreadyDecided: 'dispute-already-decided',
  disputeFsmTransitionDenied: 'dispute-fsm-transition-denied',

  // Authorization.
  permissionDenied: 'permission-denied',
  resourcePolicyDenied: 'resource-policy-denied',
} as const;

export type ProblemTypeSlug =
  (typeof PROBLEM_TYPES)[keyof typeof PROBLEM_TYPES];

/**
 * Compose a full RFC 7807 type URI from a slug + the configured base.
 */
export function problemTypeUri(baseUri: string, slug: ProblemTypeSlug): string {
  // Defensive: drop a trailing slash on the base so we always emit
  // exactly one separator. Saves "https://.../problems//foo" diagnostics.
  const base = baseUri.replace(/\/+$/, '');
  return `${base}/${slug}`;
}

/**
 * Map an AppException's `code` to a problem-type slug. New AppException
 * subclasses MUST get a slug here OR fall back to the generic by-status
 * type. Falling back is safe — clients can still switch on `status`.
 */
export const APP_CODE_TO_PROBLEM_SLUG: Readonly<Record<string, ProblemTypeSlug>> = {
  NOT_FOUND: PROBLEM_TYPES.notFound,
  UNAUTHORIZED: PROBLEM_TYPES.unauthorized,
  FORBIDDEN: PROBLEM_TYPES.forbidden,
  CONFLICT: PROBLEM_TYPES.conflict,
  DOMAIN_ERROR: PROBLEM_TYPES.unprocessable,
  BAD_REQUEST: PROBLEM_TYPES.badRequest,
  EXTERNAL_SERVICE_ERROR: PROBLEM_TYPES.badGateway,
  DUPLICATE_CASE: PROBLEM_TYPES.duplicateCase,
};
