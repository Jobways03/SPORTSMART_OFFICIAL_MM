import { z } from 'zod';

/**
 * Empty body schema for the register endpoint. The pickup address is
 * derived server-side from the Seller record (storeAddress / city / pin
 * / phone) — the admin doesn't re-type it on the button click. We
 * keep an empty Zod schema as a placeholder so the controller pipeline
 * stays uniform; future overrides (e.g. "use a different return
 * address") can be added without changing the wire shape.
 */
export const RegisterPartnerRequestSchema = z
  .object({
    /** Optional admin-supplied note recorded against the registration. */
    note: z.string().max(500).optional(),
  })
  .strict();

export type RegisterPartnerRequest = z.infer<typeof RegisterPartnerRequestSchema>;

/**
 * Successful registration body — 200 OK shape returned to the admin UI.
 * Note: we deliberately do NOT throw on partner-side failure; the
 * controller returns 200 with `ok: false + error` so the UI can render
 * the error inline and offer a retry.
 */
export const RegisterPartnerResponseSchema = z.object({
  ok: z.boolean(),
  partner: z.string(),
  status: z.enum(['PENDING', 'REGISTERED', 'FAILED', 'NOT_NEEDED']),
  warehouseName: z.string().nullable(),
  registeredAt: z.string().nullable(),
  error: z.string().optional(),
});

export type RegisterPartnerResponse = z.infer<
  typeof RegisterPartnerResponseSchema
>;
