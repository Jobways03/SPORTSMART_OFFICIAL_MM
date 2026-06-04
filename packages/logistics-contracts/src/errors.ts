import { z } from 'zod';

/**
 * Canonical error codes the facade emits in the `code` field of the
 * RFC 7807 problem-details body. Apps/api maps the same set to its
 * own user-visible messaging — keeping them in this package means
 * the two services agree on the wire enum.
 */
export const LogisticsErrorCode = z.enum([
  // 4xx — caller's problem.
  'VALIDATION_FAILED',
  'AWB_NOT_FOUND',
  'SHIPMENT_NOT_FOUND',
  'RETURN_NOT_FOUND',
  'NOT_SERVICEABLE',
  'IDEMPOTENT_REPLAY',
  'IDEMPOTENT_CONFLICT',
  'RATE_LIMITED',
  'UNAUTHORIZED',
  'FORBIDDEN',

  // 4xx — domain rules.
  'INVALID_FSM_TRANSITION',
  'COD_AMOUNT_MISMATCH',
  'WEIGHT_OVER_CARRIER_LIMIT',
  'PARTNER_NOT_REGISTERED',
  // The shipment / resource is in a state that disallows the
  // requested operation (e.g. trying to edit a Delivered shipment,
  // applying NDR action when the NSL code isn't eligible).
  'INVALID_STATE',
  // The partner refused the request because a prior operation hasn't
  // closed yet (e.g. Delhivery pickup-request — one per warehouse per
  // day until the previous closes). Retry after the upstream op
  // settles.
  'BUSY',

  // 5xx / 502 — upstream partner.
  'PARTNER_DOWN',
  'PARTNER_TIMEOUT',
  'PARTNER_REJECTED',
  'WEBHOOK_SIGNATURE_INVALID',
  'WEBHOOK_REPLAY',

  // 5xx — us.
  'INTERNAL_ERROR',
]);
export type LogisticsErrorCode = z.infer<typeof LogisticsErrorCode>;
