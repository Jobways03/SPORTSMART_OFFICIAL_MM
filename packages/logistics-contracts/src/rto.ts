import { z } from 'zod';

/**
 * Result of initiating or polling an RTO (Return-To-Origin) attempt.
 * Distinct from a customer-initiated Return — RTO is triggered by the
 * partner after delivery attempts fail and is mostly a notification
 * surface for ops + the accounting reversal flow.
 */
export const RtoAttemptResult = z.object({
  rtoId: z.string().uuid(),
  shipmentId: z.string().uuid(),
  reason: z.string().min(1).max(500),
  status: z.enum([
    'INITIATED',
    'IN_TRANSIT',
    'DELIVERED_BACK',
    'LOST',
    'DAMAGED',
  ]),
  returnedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type RtoAttemptResult = z.infer<typeof RtoAttemptResult>;
