/**
 * Carrier-neutral gateway interface. Every courier integration
 * (Delhivery, Bluedart, Shiprocket, ...) implements this port and
 * registers itself with the `CourierGatewayResolver` so the
 * shipments service can stay carrier-agnostic.
 *
 * Lifted verbatim from
 * `apps/api/src/modules/shipping/application/ports/outbound/courier-gateway.port.ts`
 * (with the iThink-specific imports collapsed into structural types
 * since the facade owns its own integrations). Keeping the shape
 * identical means an apps/api iThink adapter can be ported to this
 * service with only its imports rewritten.
 */

/** Discriminator returned by adapters so callers know who answered. */
export interface CourierAdapterMeta {
  readonly partner: string; // 'DELHIVERY' | 'BLUEDART' | ...
  readonly displayName: string;
  /** Two-letter region code; useful when one adapter spans regions. */
  readonly region?: string;
}

export interface RegisterPickupRequest {
  ownerType: 'SELLER' | 'FRANCHISE' | 'WAREHOUSE';
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
  pickupAddressId: string;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  remark?: string;
}

/**
 * Carrier-neutral shipment payload. Address shape mirrors
 * `AddressSnapshot` in @sportsmart/logistics-contracts so the
 * adapter doesn't have to redo validation.
 */
export interface CreateShipmentPayload {
  subOrderId: string;
  /**
   * Human-readable label reference (the scannable "order" barcode). Falls back
   * to subOrderId when absent. Must stay unique + deterministic per sub-order
   * (Delhivery dedupes bookings on it).
   */
  orderReference?: string;
  /**
   * Merchant identity for the label's "Seller" box (informational — returns
   * still route to the pickup warehouse). Courier falls back to the registered
   * warehouse details when absent.
   */
  sellerName?: string;
  sellerAddress?: string;
  /** Seller GSTIN for the label — caller only sets this when GST is verified. */
  sellerGstin?: string;
  /**
   * The caller's OWN registered pickup-warehouse name (exact match to a
   * warehouse in the courier panel). Used as pickup_location; falls back to the
   * facade's configured default warehouse when absent.
   */
  pickupWarehouseName?: string;
  pickupAddressId: string;
  returnAddressId: string;
  weightGrams: number;
  dimensionsCm: { lengthCm: number; widthCm: number; heightCm: number };
  declaredValuePaise: bigint;
  cod: boolean;
  codAmountPaise?: bigint;
  pickup: AddressLike;
  drop: AddressLike;
  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    unitValuePaise: bigint;
  }>;
  direction?: 'forward' | 'reverse';
  /**
   * Delhivery `transport_speed`: 'F' = Next Day Delivery (NDD), 'D' = standard
   * ground. Decided by the caller from pickup→drop distance. Defaults to 'D'.
   */
  transportSpeed?: 'F' | 'D';
}

export interface AddressLike {
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  country?: string;
}

export interface CreateShipmentResult {
  subOrderId: string;
  success: boolean;
  awb?: string;
  carrierOrderRef?: string;
  trackingUrl?: string;
  labelUrl?: string;
  errorMessage?: string;
}

export interface CancelShipmentResult {
  awb: string;
  success: boolean;
  errorMessage?: string;
}

export interface NormalisedScanRecord {
  partnerStatusCode: string;
  /** One of NormalizedStatus from @sportsmart/logistics-contracts/tracking. */
  normalizedStatus: string;
  location?: string;
  remark?: string;
  eventAt: Date;
}

export interface TrackingSnapshotResult {
  awb: string;
  partner: string;
  direction: 'forward' | 'reverse';
  currentNormalizedStatus: string;
  expectedDeliveryAt?: Date;
  events: NormalisedScanRecord[];
}

export interface PrintLabelResult {
  fileUrl: string;
}

export interface NdrActionResult {
  awb: string;
  success: boolean;
  message: string;
}

export interface ServiceabilityCheckResult {
  pincode: string;
  serviceable: boolean;
  codAvailable: boolean;
  prepaidAvailable: boolean;
  reverseAvailable: boolean;
  estimatedDeliveryDays?: number;
  quotedPricePaise?: bigint;
}

/**
 * The full contract every adapter satisfies. Methods that the
 * underlying partner does not support throw `CarrierCapabilityError`
 * rather than returning empty — the call site decides whether to
 * fall back or surface the limitation.
 */
export interface CourierGatewayPort {
  readonly meta: CourierAdapterMeta;

  checkServiceability(pincode: string): Promise<ServiceabilityCheckResult>;
  registerPickup(req: RegisterPickupRequest): Promise<RegisterPickupResult>;
  createShipment(payload: CreateShipmentPayload): Promise<CreateShipmentResult>;
  cancelShipment(awb: string): Promise<CancelShipmentResult>;
  printLabel(awbs: string[]): Promise<PrintLabelResult>;
  track(awbs: string[]): Promise<Map<string, TrackingSnapshotResult>>;
  reattempt(input: {
    awb: string;
    date: string;
    time: string;
    address: string;
    mobile: string;
    addressType: 'HOME' | 'OFFICE';
  }): Promise<NdrActionResult>;
  initiateRto(input: { awb: string; remark: string }): Promise<NdrActionResult>;
}

export class CarrierCapabilityError extends Error {
  constructor(adapter: string, capability: string) {
    super(`${adapter} does not support ${capability}`);
    this.name = 'CarrierCapabilityError';
  }
}

/** DI token for the strategy resolver. */
export const COURIER_GATEWAY_RESOLVER = Symbol('COURIER_GATEWAY_RESOLVER');

/**
 * Resolves a CourierGatewayPort implementation by partner code.
 * Concrete resolver lives at
 * `application/factories/courier-gateway.resolver.ts`.
 */
export interface CourierGatewayResolver {
  forPartner(partner: string): CourierGatewayPort;
  /** Returns every registered adapter (for partner-selector loops). */
  all(): CourierGatewayPort[];
}
