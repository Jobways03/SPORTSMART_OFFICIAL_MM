import { z } from 'zod';
import { AddressSnapshot, PaiseAmount } from './shipment';
import { PartnerCodeLoose } from './partner';

/**
 * Mirror of the Prisma `ReturnStatus` enum. The facade owns
 * partner-side pickup, transit, and arrival; the QC outcome lives in
 * the QcRecord row and drives the final state transition.
 */
export const ReturnStatus = z.enum([
  'REQUESTED',
  'PICKUP_SCHEDULED',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVED_AT_WAREHOUSE',
  'QC_PASSED',
  'QC_FAILED',
  'CLOSED',
  'CANCELLED',
]);
export type ReturnStatus = z.infer<typeof ReturnStatus>;

export const CreateReturnRequest = z.object({
  orderId: z.string().uuid(),
  subOrderId: z.string().uuid(),
  // Optional — when omitted the facade pulls the original forward
  // shipment's drop address. Supplied when the customer is returning
  // from a different location than where they received the parcel.
  pickupAddress: AddressSnapshot.optional(),
  // Free-form reason captured at the customer surface; partner-side
  // booking maps these to its reason-code dictionary.
  reason: z.string().min(1).max(500),
  // Optional carrier hint. Most returns reuse the forward partner;
  // when the forward partner has poor reverse coverage in the pincode
  // the resolver can rebook elsewhere.
  preferredPartner: PartnerCodeLoose.optional(),
  // RTO refunds need this to bound the customer's eligible amount;
  // the facade does not validate the number, it stores and forwards.
  refundCapPaise: PaiseAmount.optional(),
});
export type CreateReturnRequest = z.infer<typeof CreateReturnRequest>;

export const ReturnResponse = z.object({
  returnId: z.string().uuid(),
  orderId: z.string().uuid(),
  subOrderId: z.string().uuid(),
  reverseAwb: z.string().nullable(),
  reversePartner: PartnerCodeLoose.nullable(),
  pickupScheduledAt: z.string().datetime().nullable(),
  status: ReturnStatus,
  qcRecordId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ReturnResponse = z.infer<typeof ReturnResponse>;
