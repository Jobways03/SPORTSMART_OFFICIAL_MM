import { z } from 'zod';
import { PartnerCodeLoose } from './partner';
import { PaiseAmount } from './shipment';

/**
 * One AWB-level entry inside a partner's COD remittance pull. The
 * partner sends a CSV / API list of "we collected X for AWB Y on date
 * Z"; we materialise each row so reconciliation can match the receipt
 * to the original shipment record.
 */
export const CodRemittanceRow = z.object({
  awb: z.string().min(1).max(64),
  amountPaise: PaiseAmount,
  status: z.enum([
    'PENDING',
    'REMITTED',
    'DISPUTED',
    'ADJUSTED',
  ]),
});
export type CodRemittanceRow = z.infer<typeof CodRemittanceRow>;

export const CodRemittancePullResult = z.object({
  remittanceId: z.string().uuid(),
  partner: PartnerCodeLoose,
  utrNumber: z.string().min(1).max(64).nullable(),
  remittedAt: z.string().datetime(),
  amountPaise: PaiseAmount,
  expectedAmountPaise: PaiseAmount,
  awbCount: z.number().int().nonnegative(),
  rows: z.array(CodRemittanceRow),
});
export type CodRemittancePullResult = z.infer<typeof CodRemittancePullResult>;

/**
 * Variance row surfaced to the ops dashboard when the partner-side
 * UTR amount disagrees with the sum we computed from delivered COD
 * shipments. Ops triage these manually until the partner adjusts.
 */
export const CodVariance = z.object({
  remittanceId: z.string().uuid(),
  partner: PartnerCodeLoose,
  expectedPaise: PaiseAmount,
  actualPaise: PaiseAmount,
  variancePaise: z.coerce.bigint(),
  // Free-form ops note; partners' standard explanations include
  // "weight-dispute deduction", "RTO-in-transit holdback", etc.
  reason: z.string().max(500).nullable(),
});
export type CodVariance = z.infer<typeof CodVariance>;
