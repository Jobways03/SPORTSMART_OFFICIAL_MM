import { z } from 'zod';

/**
 * Response shape for `GET /admin/logistics-partner/partners` —
 * pass-through of the facade's PartnerInfo array. Keeping a local Zod
 * schema lets us validate the facade's response before handing it to
 * the admin UI and rejects upstream drift loudly.
 */
export const WarehouseCapabilitySchema = z.enum([
  'REQUIRED',
  'NOT_NEEDED',
  'OPTIONAL',
]);

export const PartnerInfoSchema = z.object({
  code: z.string().min(2).max(32),
  displayName: z.string().min(1),
  capabilities: z.object({
    warehouseRegistration: WarehouseCapabilitySchema,
  }),
});

export const ListPartnersResponseSchema = z.array(PartnerInfoSchema);
export type ListPartnersResponse = z.infer<typeof ListPartnersResponseSchema>;

/**
 * Response shape for `GET /admin/logistics-partner/sellers/:id/registrations`.
 * One row per (seller, partner) tuple. Status mirrors the DB column.
 */
export const SellerRegistrationItemSchema = z.object({
  partner: z.string(),
  warehouseName: z.string().nullable(),
  status: z.enum(['PENDING', 'REGISTERED', 'FAILED', 'NOT_NEEDED']),
  lastError: z.string().nullable(),
  registeredAt: z.string().nullable(),
  registeredBy: z.string().nullable(),
  updatedAt: z.string(),
});

export const ListSellerRegistrationsResponseSchema = z.array(
  SellerRegistrationItemSchema,
);

export type ListSellerRegistrationsResponse = z.infer<
  typeof ListSellerRegistrationsResponseSchema
>;
export type SellerRegistrationItem = z.infer<
  typeof SellerRegistrationItemSchema
>;
