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
 * Result shapes are deliberately small — adapters translate iThink's
 * verbose responses to these so callers don't have to know which
 * carrier they're talking to.
 */

/** Discriminator returned by adapters so callers know who answered. */
export interface CourierAdapterMeta {
  readonly method: DeliveryMethod;
  readonly carrier: string; // 'iThink:delhivery' | 'self-delivery' | ...
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
  // The full domain shipment payload — see `DomainShipment` in the
  // iThink mapper for field-by-field shape. Kept as a structural
  // type to avoid coupling the port to the integration package.
  shipment: import('../../../../../integrations/ithink/mappers/ithink-shipment.mapper').DomainShipment;
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
