import { z } from 'zod';
import { PartnerCodeLoose } from './partner';
import { PaiseAmount } from './shipment';

/**
 * Single-pincode serviceability check. Used by the storefront /
 * checkout pre-flight to decide which carriers can serve a given drop
 * pincode for a given mode (prepaid vs COD vs reverse).
 */
export const ServiceabilityRequest = z.object({
  pincode: z.string().regex(/^\d{6}$/),
  mode: z.enum(['PREPAID', 'COD', 'REVERSE']).default('PREPAID'),
  weightGrams: z.number().int().positive().optional(),
  declaredValuePaise: PaiseAmount.optional(),
});
export type ServiceabilityRequest = z.infer<typeof ServiceabilityRequest>;

/**
 * One viable partner for the requested pincode + mode. Returned in the
 * facade's "best to worst" order — the caller can pick the first or
 * present the list to the customer.
 */
export const PartnerOption = z.object({
  partner: PartnerCodeLoose,
  zone: z.string().min(1).max(8),
  prepaid: z.boolean(),
  cod: z.boolean(),
  reverse: z.boolean(),
  estimatedDeliveryDays: z.number().int().positive().nullable(),
  // Quote in paise when the partner returns one; null when the rate
  // requires a separate API call.
  quotedPriceePaise: PaiseAmount.nullable(),
  // 0.0–1.0 — facade-computed score blending historic success rate,
  // RTO rate, and pickup adherence. Ops can sort the list on this.
  healthScore: z.number().min(0).max(1).nullable(),
});
export type PartnerOption = z.infer<typeof PartnerOption>;

export const ServiceabilityResult = z.object({
  pincode: z.string().regex(/^\d{6}$/),
  serviceable: z.boolean(),
  options: z.array(PartnerOption),
});
export type ServiceabilityResult = z.infer<typeof ServiceabilityResult>;
