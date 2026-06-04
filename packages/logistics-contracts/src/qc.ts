import { z } from 'zod';

/**
 * Outcome of warehouse QC on a returned parcel. Drives the final
 * settlement direction — PASS releases the refund, FAIL forfeits all
 * or part of it, PARTIAL records a deduction (damaged but resaleable).
 */
export const QcOutcome = z.enum([
  'PASS',
  'FAIL',
  'PARTIAL',
]);
export type QcOutcome = z.infer<typeof QcOutcome>;

export const QcPhoto = z.object({
  url: z.string().url(),
  // Caption from the QC operator (e.g. "tag missing", "stain on collar").
  caption: z.string().max(200).optional(),
  takenAt: z.string().datetime(),
});
export type QcPhoto = z.infer<typeof QcPhoto>;

export const CreateQcRecordRequest = z.object({
  returnId: z.string().uuid(),
  inspectorId: z.string().min(1).max(64),
  outcome: QcOutcome,
  notes: z.string().max(2000).optional(),
  photos: z.array(QcPhoto).max(20).default([]),
  // Required when outcome=PARTIAL — paise to deduct from the refund.
  deductionPaise: z.coerce.bigint().nonnegative().optional(),
}).superRefine((val, ctx) => {
  if (val.outcome === 'PARTIAL' && val.deductionPaise === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'deductionPaise required when outcome=PARTIAL',
      path: ['deductionPaise'],
    });
  }
});
export type CreateQcRecordRequest = z.infer<typeof CreateQcRecordRequest>;
