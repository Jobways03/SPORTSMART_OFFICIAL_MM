import { z } from 'zod';
import { PartnerCodeLoose } from './partner';

/**
 * Money is always paise (integer hundredths of INR) on the wire so
 * we never round through a float. `z.coerce.bigint()` accepts both
 * strings (which is what `JSON.stringify(BigInt)` produces on the
 * apps/api side — see the BigInt.toJSON monkey-patch in main.ts)
 * and numbers (for clients that don't yet route through BigInt).
 */
export const PaiseAmount = z.coerce.bigint().nonnegative();
export type PaiseAmount = z.infer<typeof PaiseAmount>;

/**
 * Snapshot of an address at the time a shipment was created. Stored
 * as JSON on the Shipment row so the partner-side booking is replayable
 * even if the customer / warehouse later edits their saved address.
 *
 * Field names match apps/api's customer-address shape (pincode/state/
 * country/landmark) so the same DTO can be lifted from the order saga
 * without translation.
 */
export const AddressSnapshot = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(7).max(20),
  email: z.string().email().optional(),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  landmark: z.string().max(200).optional(),
  city: z.string().min(1).max(120),
  state: z.string().min(1).max(120),
  pincode: z.string().regex(/^\d{6}$/, 'pincode must be 6 digits'),
  country: z.string().default('IN'),
  // GST registration of the consignor/consignee, when applicable. Optional
  // for B2C; required for B2B shipments because partners pass it through
  // to the eway-bill flow.
  gstin: z.string().regex(/^[0-9A-Z]{15}$/).optional(),
});
export type AddressSnapshot = z.infer<typeof AddressSnapshot>;

/**
 * One line in the shipment manifest. Quantities and values are
 * captured per item so partner-side commercial invoices can be
 * regenerated without rejoining the order tables.
 */
export const ShipmentItem = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  hsn: z.string().regex(/^\d{4,8}$/).optional(),
  quantity: z.number().int().positive(),
  unitValuePaise: PaiseAmount,
  weightGrams: z.number().int().nonnegative().optional(),
});
export type ShipmentItem = z.infer<typeof ShipmentItem>;

/**
 * Mutually exclusive lifecycle of a shipment, kept in sync with the
 * Prisma `ShipmentStatus` enum and the FSM in
 * `core/fsm/tracking-status.fsm.ts`.
 *
 * Forward path:   DRAFT -> BOOKED -> PICKED_UP -> IN_TRANSIT
 *                 -> OUT_FOR_DELIVERY -> DELIVERED
 *
 * Exception path: any state -> NDR -> (re-attempt loops back) | RTO_INITIATED
 *                 RTO_INITIATED -> RTO_IN_TRANSIT -> RTO_DELIVERED
 *                 any pre-pickup state -> CANCELLED | LOST | DAMAGED
 */
export const ShipmentStatus = z.enum([
  'DRAFT',
  'BOOKED',
  'PICKED_UP',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'NDR',
  'RTO_INITIATED',
  'RTO_IN_TRANSIT',
  'RTO_DELIVERED',
  'CANCELLED',
  'LOST',
  'DAMAGED',
]);
export type ShipmentStatus = z.infer<typeof ShipmentStatus>;

export const DimensionsCm = z.object({
  lengthCm: z.number().positive(),
  widthCm: z.number().positive(),
  heightCm: z.number().positive(),
});
export type DimensionsCm = z.infer<typeof DimensionsCm>;

/**
 * Fulfilment mode discriminator. Carrier-neutral hint the caller can
 * pass to indicate whether the parcel ships from a marketplace seller
 * or from SportsMart's own warehouse. Partner adapters use this to
 * pick the correct partner product line (e.g. Shadowfax's
 * `order_type: "marketplace"` vs `order_type: "warehouse"`).
 *
 * Defaults to MARKETPLACE so existing callers don't have to change.
 */
export const FulfilmentMode = z.enum(['MARKETPLACE', 'WAREHOUSE']);
export type FulfilmentMode = z.infer<typeof FulfilmentMode>;

/**
 * Payload accepted by `POST /internal/shipments`. The facade is the
 * one place that decides which courier to book, so the caller does
 * NOT pass a partner code — they pass enough context (zone, COD flag,
 * weight) for the partner selector to choose.
 */
export const CreateShipmentRequest = z.object({
  orderId: z.string().uuid(),
  subOrderId: z.string().uuid(),
  // Human-readable reference printed on the courier label (the scannable
  // "order" barcode). Defaults to subOrderId when omitted. Caller builds it
  // as "<orderNumber>-<short unique tag>" so warehouse staff can eyeball-match
  // a parcel to the order while it stays unique-per-sub-order (Delhivery dedupes
  // on `order`, so it must be unique AND deterministic per sub-order).
  orderReference: z.string().min(1).max(64).optional(),
  // Merchant identity printed on the courier label's "Seller" box
  // (informational — returns still route to the pickup warehouse). When omitted
  // the courier falls back to the registered pickup warehouse's own details.
  sellerName: z.string().min(1).max(120).optional(),
  sellerAddress: z.string().min(1).max(300).optional(),
  // Seller GSTIN for the label — caller sends this ONLY when the GST is
  // verified (unverified GSTs are never printed).
  sellerGstin: z.string().min(1).max(20).optional(),
  // The caller's OWN registered pickup-warehouse name (must EXACTLY match a
  // warehouse in the courier panel). Used as pickup_location so the parcel
  // ships from the seller's/franchise's warehouse. Falls back to the facade's
  // configured default warehouse when omitted.
  pickupWarehouseName: z.string().min(1).max(120).optional(),
  // Optional caller override. When set the resolver MUST honour it or
  // fail loudly — partners are not silently substituted.
  partnerHint: PartnerCodeLoose.optional(),
  pickup: AddressSnapshot,
  drop: AddressSnapshot,
  items: z.array(ShipmentItem).min(1),
  weightGrams: z.number().int().positive(),
  dimensions: DimensionsCm,
  declaredValuePaise: PaiseAmount,
  cod: z.boolean(),
  // Required when `cod=true`; partner-side booking rejects mismatched values.
  codAmountPaise: PaiseAmount.optional(),
  // Customer-supplied flag for fragile / liquid / oversized; partners
  // translate this to their internal "handling instructions" field.
  fragile: z.boolean().default(false),
  // Optional fulfilment mode hint — adapters use this to pick the
  // right partner product line. Defaults to MARKETPLACE.
  fulfilmentMode: FulfilmentMode.optional(),
  // Forward (normal delivery) vs reverse (customer return pickup). Defaults to
  // 'forward'. When 'reverse' the adapter books a reverse pickup (Delhivery
  // RVP) instead of a forward shipment — `pickup` is the customer's address and
  // `drop` is the seller/warehouse return address.
  direction: z.enum(['forward', 'reverse']).optional(),
}).superRefine((val, ctx) => {
  if (val.cod && val.codAmountPaise === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'codAmountPaise is required when cod=true',
      path: ['codAmountPaise'],
    });
  }
  if (!val.cod && val.codAmountPaise !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'codAmountPaise must be omitted when cod=false',
      path: ['codAmountPaise'],
    });
  }
});
export type CreateShipmentRequest = z.infer<typeof CreateShipmentRequest>;

export const CreateShipmentResponse = z.object({
  shipmentId: z.string().uuid(),
  orderId: z.string().uuid(),
  subOrderId: z.string().uuid(),
  partner: PartnerCodeLoose,
  awb: z.string().nullable(),
  carrierOrderRef: z.string().nullable(),
  status: ShipmentStatus,
  labelUrl: z.string().url().nullable(),
  trackingUrl: z.string().url().nullable(),
  bookedAt: z.string().datetime().nullable(),
});
export type CreateShipmentResponse = z.infer<typeof CreateShipmentResponse>;

export const CancelShipmentRequest = z.object({
  reason: z.string().min(1).max(500),
  // When true, the facade will also attempt to cancel the upstream
  // courier booking. Default true — only flip to false when ops are
  // reconciling a partner-side cancellation that already happened.
  cancelWithPartner: z.boolean().default(true),
});
export type CancelShipmentRequest = z.infer<typeof CancelShipmentRequest>;

export const ShipmentResponse = CreateShipmentResponse.extend({
  weightGrams: z.number().int().nonnegative(),
  declaredValuePaise: PaiseAmount,
  cod: z.boolean(),
  codAmountPaise: PaiseAmount.nullable(),
  pickupAddress: AddressSnapshot,
  dropAddress: AddressSnapshot,
  lastTrackingEventAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ShipmentResponse = z.infer<typeof ShipmentResponse>;
