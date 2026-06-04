import { z } from 'zod';

/**
 * Canonical pickup-location address request for
 * `POST /v1/partners/:code/warehouses`. Maps onto the lowest-common-
 * denominator of every partner's "create warehouse" surface (Delhivery
 * `client_warehouse/create` is the current reference; future partners
 * map their own field names from this DTO).
 *
 *   • `name`            — the canonical pickup-location identifier the
 *                         partner echoes back on every shipment. Must
 *                         be unique per partner-side account; for
 *                         Delhivery this is immutable after creation.
 *   • `phone` + `pin`   — both required by Delhivery; we surface them
 *                         as required at the boundary so callers fail
 *                         fast rather than 4xx-ing inside the adapter.
 *   • `returnAddress`   — used for RTO. Defaults to `address` server-
 *                         side when omitted (Delhivery requires it).
 */
export const RegisterWarehouseRequest = z.object({
  name: z.string().min(1).max(64),
  registeredName: z.string().min(1).max(128).optional(),
  contactPerson: z.string().min(1).max(128).optional(),
  phone: z.string().min(8).max(20),
  email: z.string().email().optional(),
  address: z.string().min(1).max(255).optional(),
  city: z.string().min(1).max(64).optional(),
  pin: z.string().regex(/^[0-9]{6}$/, '6-digit Indian pincode required'),
  country: z.string().min(2).max(32).optional(),
  returnAddress: z.string().min(1).max(255).optional(),
  returnPin: z.string().regex(/^[0-9]{6}$/).optional(),
  returnCity: z.string().min(1).max(64).optional(),
  returnState: z.string().min(2).max(64).optional(),
  returnCountry: z.string().min(2).max(32).optional(),
});
export type RegisterWarehouseRequest = z.infer<typeof RegisterWarehouseRequest>;

/**
 * Editable fields on an EXISTING warehouse. Delhivery's "Warehouse
 * Updation" form allows phone, address, pin, and registered name; the
 * warehouse `name` is the immutable identifier (path param, not here),
 * and contact_person cannot be changed after creation.
 */
export const UpdateWarehouseRequest = z.object({
  registeredName: z.string().min(1).max(128).optional(),
  phone: z.string().min(8).max(20).optional(),
  address: z.string().min(1).max(255).optional(),
  pin: z.string().regex(/^[0-9]{6}$/, '6-digit Indian pincode required').optional(),
});
export type UpdateWarehouseRequest = z.infer<typeof UpdateWarehouseRequest>;

/**
 * Response status values:
 *   REGISTERED — partner confirmed warehouse exists / was created.
 *   FAILED     — partner returned an error; `error` populated.
 *
 * NOTE: this DTO is the "happy path" body. Validation failures + 4xx
 * errors flow through Nest's global filter to RFC 7807 problem-details
 * — they do NOT come back with `status: 'FAILED'`. The FAILED status
 * is reserved for cases where the partner accepted the call but
 * declined the registration (duplicate name, invalid pin combo).
 */
export const RegisterWarehouseStatus = z.enum(['REGISTERED', 'FAILED']);
export type RegisterWarehouseStatus = z.infer<typeof RegisterWarehouseStatus>;

export const RegisterWarehouseResponse = z.object({
  partner: z.string().min(2).max(32),
  /** Canonical warehouse identifier echoed by the partner. */
  warehouseName: z.string().min(1),
  /** Optional numeric ID partners like Delhivery also return. */
  warehouseId: z.string().optional(),
  status: RegisterWarehouseStatus,
  /** ISO 8601 timestamp the facade observed the registration. */
  registeredAt: z.string(),
  /** Populated only when `status === 'FAILED'`. */
  error: z.string().optional(),
});
export type RegisterWarehouseResponse = z.infer<typeof RegisterWarehouseResponse>;
