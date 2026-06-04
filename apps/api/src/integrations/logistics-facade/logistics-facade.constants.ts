/**
 * DI tokens + canonical partner codes for the logistics-facade
 * integration.
 *
 * Mirrors the convention used by other apps/api integrations
 * (razorpay, opensearch): every wire-name lives in a constants file
 * so call-sites import a `const` rather than re-typing strings.
 */

export const LOGISTICS_FACADE_CONFIG = Symbol('LOGISTICS_FACADE_CONFIG');

/**
 * Partner codes the facade currently advertises. Kept in sync with
 * `packages/logistics-contracts/src/partner.ts` PartnerCode enum.
 * Adding a new partner is a single-line change here once the facade
 * registers it.
 */
export const PARTNER_CODES = {
  DELHIVERY: 'DELHIVERY',
  SHADOWFAX: 'SHADOWFAX',
} as const;

export type PartnerCode = (typeof PARTNER_CODES)[keyof typeof PARTNER_CODES];

/** Status values written to SellerPartnerRegistration.status. */
export const REGISTRATION_STATUS = {
  PENDING: 'PENDING',
  REGISTERED: 'REGISTERED',
  FAILED: 'FAILED',
  NOT_NEEDED: 'NOT_NEEDED',
} as const;

export type RegistrationStatus =
  (typeof REGISTRATION_STATUS)[keyof typeof REGISTRATION_STATUS];

/** Retry budget for the facade HTTP client. Reads only; writes are
 *  idempotent at the facade boundary (partner-side dedupe). */
export const LOGISTICS_FACADE_RETRY_MAX_ATTEMPTS = 2;
export const LOGISTICS_FACADE_RETRY_BASE_DELAY_MS = 250;
export const LOGISTICS_FACADE_REQUEST_TIMEOUT_MS = 30_000;
