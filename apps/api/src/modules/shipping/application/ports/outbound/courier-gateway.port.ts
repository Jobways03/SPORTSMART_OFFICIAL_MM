import type { DeliveryMethod } from '@prisma/client';

/**
 * Carrier-neutral gateway interface. Implemented by:
 *
 *   * `IThinkCourierAdapter`   — booked-shipment path
 *   * `SelfDeliveryCourierAdapter` — seller / franchise self-delivery path
 *
 * The shipping use cases never reference a concrete adapter; they
 * resolve one via the strategy registry based on
 * `subOrder.deliveryMethod`. New carriers later (Delhivery direct,
 * Shiprocket, etc.) drop in by implementing this port and registering
 * a strategy for a new DeliveryMethod enum value.
 *
 * Result shapes are deliberately small — adapters translate each
 * carrier's verbose responses to these so callers don't have to know
 * which carrier they're talking to.
 */

/** Discriminator returned by adapters so callers know who answered. */
export interface CourierAdapterMeta {
  readonly method: DeliveryMethod;
  readonly carrier: string; // 'self-delivery' | <future-carrier> | ...
}

/** Courier-neutral address used in a shipment booking payload. */
export interface DomainAddress {
  name: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  country?: string;
  phone: string;
  email?: string;
}

/** Courier-neutral line item in a shipment booking payload. */
export interface DomainProduct {
  name: string;
  sku?: string;
  quantity: number;
  /** Rupees as decimal string. */
  unitPrice: string;
  hsn?: string;
}

/**
 * Courier-neutral shipment payload. Carrier adapters translate this into
 * their own request shape. Was previously the iThink mapper's
 * `DomainShipment`; decoupled from any specific carrier when iThink was
 * removed so the port stays provider-agnostic for a future courier.
 */
export interface DomainShipment {
  orderNumber: string;
  subOrderNumber?: string;
  orderDate: Date | string;
  /** Rupees as decimal string. */
  totalAmount: string;
  shipping: DomainAddress;
  billing?: DomainAddress;
  products: DomainProduct[];
  /** cm. */
  dimensions: { length: number; width: number; height: number };
  /** kg (decimal, not grams). */
  weightKg: number;
  /** 'cod' | 'prepaid'. */
  paymentMode: string;
  /** Rupees as decimal string. Required when paymentMode is 'cod'. */
  codAmount?: string;
  shippingCharges?: string;
  totalDiscount?: string;
  gstNumber?: string;
  /**
   * Merchant identity printed on the courier label's "Seller" box.
   * Informational only — returns still route to the pickup warehouse, so this
   * does NOT change the return/RTO address.
   */
  sellerName?: string;
  sellerAddress?: string;
  /**
   * Seller GSTIN to print on the label — caller MUST only set this when the
   * GST is verified (we never print an unconfirmed GST). Informational.
   */
  sellerGstin?: string;
  /**
   * The node's OWN registered courier pickup-warehouse name (exact match to a
   * warehouse in the carrier panel). Used as the booking's pickup_location so
   * the parcel ships from the seller's/franchise's own warehouse — and so it
   * matches the warehouse "Request pickup" schedules. Falls back to the
   * carrier's configured default warehouse when absent.
   */
  pickupWarehouseName?: string;
  ewayBillNumber?: string;
  direction?: 'forward' | 'reverse';
  /**
   * Delhivery `transport_speed`: 'F' = Next Day Delivery (NDD), 'D' = standard
   * ground. Decided at booking time from the pickup→drop distance (≤ threshold
   * → 'F'). Optional; the facade / Delhivery mapper defaults to 'D'.
   */
  transportSpeed?: 'F' | 'D';
  /** Optional carrier preference slug (free-form). */
  logistics?: string;
  serviceType?: string;
  pickupAddressId: string;
  returnAddressId: string;
}

/** Request to register a new pickup origin with the carrier. */
export interface RegisterPickupRequest {
  ownerType: 'SELLER' | 'FRANCHISE';
  ownerId: string;
  companyName: string;
  address1: string;
  address2?: string;
  mobile: string;
  pincode: string;
  city: string;
  state: string;
  country?: string;
  gps?: string;
}

export interface RegisterPickupResult {
  /** Carrier-side warehouse id (iThink's `pickup_address_id`). */
  pickupAddressId: string;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  remark?: string;
}

/** Domain-side shipment payload (kept in step with `DomainShipment`). */
export interface CreateShipmentRequest {
  /**
   * Per-SubOrder caller-supplied id. Adapters echo it back so the use
   * case can correlate response → SubOrder when batching multiple.
   */
  subOrderId: string;
  pickupAddressId: string;
  returnAddressId: string;
  // The full domain shipment payload (courier-neutral; see DomainShipment
  // above). Self-delivery ignores it; a future carrier adapter consumes it.
  shipment: DomainShipment;
  direction?: 'forward' | 'reverse';
  carrierPreference?: string;
}

export interface CreateShipmentResult {
  subOrderId: string;
  success: boolean;
  awb?: string;
  carrier?: string;
  trackingUrl?: string;
  orderRefnum?: string;
  errorMessage?: string;
}

export interface CancelShipmentResult {
  awb: string;
  success: boolean;
  errorMessage?: string;
}

export interface NormalisedScanRecord {
  status: string; // ShipmentStatusInternal
  rawStatus: string;
  rawStatusCode: string;
  scanLocation: string;
  remark: string;
  scanAt: Date;
  reason?: string;
}

export interface TrackingSnapshot {
  awb: string;
  carrier: string;
  direction: 'forward' | 'reverse';
  currentStatus: string;
  rawCurrentStatus: string;
  expectedDelivery?: Date;
  promiseDelivery?: Date;
  scans: NormalisedScanRecord[];
  // Phase 88 (2026-05-23) — Shipment Evidence Gap #3. Carrier-side
  // POD artifacts surfaced from the webhook payload when the
  // current status normalises to DELIVERED (or RTO_DELIVERED).
  // applySnapshot persists these as a ShipmentEvidence(kind=POD or
  // RTO_PROOF) row so the customer order detail page + admin
  // dispute panel have actual proof to render.
  podUrl?: string | null;
  signatureUrl?: string | null;
  signedByName?: string | null;
  customerOtpHash?: string | null;
}

export interface PrintLabelResult {
  fileUrl: string;
}

export interface NdrActionResult {
  awb: string;
  success: boolean;
  message: string;
}

export interface ServiceabilityResult {
  pincode: string;
  serviceable: boolean;
  codAvailable: boolean;
  prepaidAvailable: boolean;
  /** Per-carrier capability detail (for adapters that have multiple). */
  carriers: Array<{
    carrier: string;
    prepaid: boolean;
    cod: boolean;
    pickup: boolean;
  }>;
}

/**
 * The contract every courier adapter satisfies. Methods unsupported
 * by a particular adapter (e.g., `printLabel` for SelfDelivery) throw
 * `CarrierCapabilityError` rather than returning empty — the call
 * site decides whether to fall back or surface the limitation.
 */
export interface CourierGatewayPort {
  readonly meta: CourierAdapterMeta;

  /** Phase A — pre-purchase serviceability check. */
  checkServiceability(pincode: string): Promise<ServiceabilityResult>;

  /** Phase B — register a new pickup origin (idempotent on owner id). */
  registerPickup(req: RegisterPickupRequest): Promise<RegisterPickupResult>;

  /** Phase B — book a shipment. */
  createShipment(req: CreateShipmentRequest): Promise<CreateShipmentResult>;

  /** Phase B — print docs (label / manifest / invoice). May be unsupported. */
  printLabel(awbs: string[]): Promise<PrintLabelResult>;

  /** Phase C — current tracking snapshot for one or more AWBs. */
  track(awbs: string[]): Promise<Map<string, TrackingSnapshot>>;

  /** Phase D — cancel pre-pickup. */
  cancelShipment(awb: string): Promise<CancelShipmentResult>;

  /** Phase D — NDR reattempt. */
  reattempt(input: {
    awb: string;
    date: string;
    time: string;
    address: string;
    mobile: string;
    addressType: 'HOME' | 'OFFICE';
  }): Promise<NdrActionResult>;

  /** Phase D — RTO. */
  initiateRto(input: { awb: string; remark: string }): Promise<NdrActionResult>;
}

/**
 * Thrown by adapters when a caller requests something the underlying
 * carrier doesn't support (e.g., asking SelfDelivery for a label).
 */
export class CarrierCapabilityError extends Error {
  constructor(adapter: string, capability: string) {
    super(`${adapter} does not support ${capability}`);
    this.name = 'CarrierCapabilityError';
  }
}

/** DI token for the strategy resolver. */
export const COURIER_GATEWAY_RESOLVER = Symbol('COURIER_GATEWAY_RESOLVER');

/**
 * Resolves a CourierGatewayPort implementation by DeliveryMethod.
 * Concrete resolver lives at `infrastructure/factories/courier-gateway.resolver.ts`.
 */
export interface CourierGatewayResolver {
  forMethod(method: DeliveryMethod): CourierGatewayPort;
}
