import { z } from 'zod';

/**
 * Non-Delivery-Report follow-up actions. Each partner's NDR webhook
 * tells us "delivery failed, customer wants X"; the facade translates
 * X into one of these and pushes it back to the partner API.
 *
 * REATTEMPT       — try delivery again on a scheduled date.
 * RESCHEDULE      — same as reattempt but with a new address window.
 * RETURN_TO_ORIGIN — abandon delivery, send back; triggers RTO flow.
 * HOLD_AT_HUB     — customer wants pickup themselves; partner holds the
 *                   parcel for N days before auto-RTO.
 */
export const NdrAction = z.enum([
  'REATTEMPT',
  'RESCHEDULE',
  'RETURN_TO_ORIGIN',
  'HOLD_AT_HUB',
]);
export type NdrAction = z.infer<typeof NdrAction>;

/**
 * One row in the NdrAttempt table. Reason codes are partner-specific
 * but normalised against an internal dictionary in `core/ndr-codes`
 * (lands in M2).
 */
export const NdrReattemptRequest = z.object({
  action: NdrAction,
  scheduledFor: z.string().datetime().optional(),
  // Free-form note shown in the partner-side ops console.
  note: z.string().max(500).optional(),
  // Required when action=RESCHEDULE; the contact details to deliver to.
  rescheduleContact: z.object({
    name: z.string().min(1).max(120),
    phone: z.string().min(7).max(20),
    addressLine: z.string().min(1).max(200),
  }).optional(),
}).superRefine((val, ctx) => {
  if (val.action === 'RESCHEDULE' && !val.rescheduleContact) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'rescheduleContact required when action=RESCHEDULE',
      path: ['rescheduleContact'],
    });
  }
  if (val.action === 'REATTEMPT' && !val.scheduledFor) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'scheduledFor required when action=REATTEMPT',
      path: ['scheduledFor'],
    });
  }
});
export type NdrReattemptRequest = z.infer<typeof NdrReattemptRequest>;
