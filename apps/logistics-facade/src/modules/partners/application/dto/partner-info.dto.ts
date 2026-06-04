import { z } from 'zod';

/**
 * Per-partner capability discovery.
 *
 *   REQUIRED   — partner expects pickup-locations pre-registered as
 *                named warehouses (Delhivery: `client_warehouse/create`).
 *   NOT_NEEDED — partner accepts pickup details inline per shipment
 *                (Shadowfax marketplace API).
 *   OPTIONAL   — partner supports both; per-shipment override default.
 *
 * Adding a new value means updating the admin-UI panel switch — the
 * frontend keys its action button on the literal string here.
 */
export const WarehouseCapability = z.enum(['REQUIRED', 'NOT_NEEDED', 'OPTIONAL']);
export type WarehouseCapability = z.infer<typeof WarehouseCapability>;

export const PartnerCapabilities = z.object({
  warehouseRegistration: WarehouseCapability,
});
export type PartnerCapabilities = z.infer<typeof PartnerCapabilities>;

/**
 * The response shape for `GET /v1/partners`. The admin UI iterates over
 * this list, renders one row per partner, and picks an action based on
 * `capabilities.warehouseRegistration`. The wire shape is intentionally
 * additive — adding a new capability key does not break older clients.
 */
export const PartnerInfo = z.object({
  /**
   * Canonical partner code. Matches the Zod `PartnerCode` enum in
   * @sportsmart/logistics-contracts. Uppercase, snake-safe.
   */
  code: z.string().min(2).max(32).regex(/^[A-Z0-9_]+$/),
  /** Marketing-facing label shown in the admin UI + logs. */
  displayName: z.string().min(1),
  capabilities: PartnerCapabilities,
});
export type PartnerInfo = z.infer<typeof PartnerInfo>;

export const PartnerListResponse = z.array(PartnerInfo);
export type PartnerListResponse = z.infer<typeof PartnerListResponse>;
