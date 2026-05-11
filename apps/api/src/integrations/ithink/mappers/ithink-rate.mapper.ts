import type { IThinkGetRateCarrierRow } from '../dtos/get-rate.dto';
import type { IThinkPincodeCarrierCapability } from '../dtos/check-pincode.dto';

/**
 * Carrier-neutral rate quote used by checkout / cart. We normalise
 * iThink's 'Y'/'N' strings to booleans and coerce rate to number so
 * the rest of the platform never has to handle their wire conventions.
 */
export interface RateQuote {
  carrier: string;
  serviceType: string | null;
  rateRupees: number;
  zone: string;
  deliveryTatDays: string;
  prepaidSupported: boolean;
  codSupported: boolean;
  pickupSupported: boolean;
  reversePickupSupported: boolean;
}

export function normaliseRateRow(row: IThinkGetRateCarrierRow): RateQuote {
  return {
    carrier: row.logistic_name,
    serviceType: row.logistic_service_type || null,
    rateRupees: typeof row.rate === 'number' ? row.rate : Number(row.rate) || 0,
    zone: row.logistics_zone,
    deliveryTatDays: row.delivery_tat,
    prepaidSupported: yesNo(row.prepaid),
    codSupported: yesNo(row.cod),
    pickupSupported: yesNo(row.pickup),
    reversePickupSupported: yesNo(row.rev_pickup),
  };
}

/**
 * Aggregate per-carrier pincode capability into a single "is this
 * pincode serviceable for COD" / "for prepaid" view used by the cart.
 * iThink's response shape is `pincode -> carrier -> capability`; we
 * usually only care whether ANY carrier serves it.
 */
export interface PincodeCapability {
  pincode: string;
  prepaid: boolean;
  cod: boolean;
  pickup: boolean;
  carriers: Array<{
    carrier: string;
    prepaid: boolean;
    cod: boolean;
    pickup: boolean;
    district: string;
    stateCode: string;
    sortCode: string;
  }>;
}

export function normalisePincode(
  pincode: string,
  carriersByName: Record<string, IThinkPincodeCarrierCapability>,
): PincodeCapability {
  const carriers = Object.entries(carriersByName).map(([carrier, cap]) => ({
    carrier,
    prepaid: yesNo(cap.prepaid),
    cod: yesNo(cap.cod),
    pickup: yesNo(cap.pickup),
    district: cap.district,
    stateCode: cap.state_code,
    sortCode: cap.sort_code,
  }));

  return {
    pincode,
    prepaid: carriers.some((c) => c.prepaid),
    cod: carriers.some((c) => c.cod),
    pickup: carriers.some((c) => c.pickup),
    carriers,
  };
}

function yesNo(value: string | undefined | null): boolean {
  if (!value) return false;
  return value.toUpperCase() === 'Y';
}
