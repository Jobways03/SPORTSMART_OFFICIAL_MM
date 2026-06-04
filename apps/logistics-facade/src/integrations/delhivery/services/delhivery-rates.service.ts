import { Injectable } from '@nestjs/common';
import { DelhiveryClient } from '../clients/delhivery.client';
import type { ServiceabilityCheckResult } from '../../../modules/shipments/application/ports/outbound/courier-gateway.port';
import { DELHIVERY_PATHS } from '../delhivery.constants';
import type {
  DelhiveryPincodeRecord,
  DelhiveryServiceabilityResponse,
} from '../dtos/delhivery-serviceability.dto';
import type {
  DelhiveryExpectedTatRequest,
  DelhiveryExpectedTatResponse,
  DelhiveryMot,
  DelhiveryProductType,
} from '../dtos/delhivery-tat.dto';
import type {
  DelhiveryHeavyServiceabilityResponse,
} from '../dtos/delhivery-heavy-serviceability.dto';
import type {
  DelhiveryCalculateCostRequest,
  DelhiveryCalculateCostResponse,
  DelhiveryCalculateCostResponseEntry,
  DelhiveryCostMode,
  DelhiveryCostPackageType,
  DelhiveryCostPaymentType,
  DelhiveryCostShipmentStatus,
} from '../dtos/delhivery-cost.dto';
import { CarrierError } from './delhivery-order.service';
import { mapDelhiveryError } from '../mappers/delhivery-error.mapper';

export interface CalculateCostInput {
  mode: DelhiveryCostMode; // E (Express) | S (Surface)
  weightGrams: number;
  originPincode: string;
  destinationPincode: string;
  shipmentStatus?: DelhiveryCostShipmentStatus; // default Delivered
  paymentType?: DelhiveryCostPaymentType;       // default Pre-paid
  lengthCm?: number;
  breadthCm?: number;
  heightCm?: number;
  packageType?: DelhiveryCostPackageType;
}

export interface CalculateCostResult {
  /** Quoted total — paise (BigInt) to match the canonical contract. */
  pricePaise: bigint;
  /** Raw INR value Delhivery quoted, for audit. */
  inrTotal: number;
  /** Zone classification ("A"…"E"). */
  zone?: string;
  /** Per-charge breakdown — passed through verbatim. */
  breakdown: DelhiveryCalculateCostResponseEntry;
}

export interface ExpectedTatResult {
  expectedDeliveryDate?: string;
  tatDays?: number;
  raw: DelhiveryExpectedTatResponse;
}

/**
 * Rate-card + serviceability surface.
 *
 * Endpoints covered:
 *   • Pincode Serviceability (GET /c/api/pin-codes/json/)
 *   • Heavy Serviceability   (GET /api/dc/fetch/serviceability/pincode)
 *   • Expected TAT           (GET /api/dc/expected_tat)
 *   • Calculate Cost         (GET /api/kinko/v1/invoice/charges/.json)
 */
@Injectable()
export class DelhiveryRatesService {
  constructor(private readonly client: DelhiveryClient) {}

  /**
   * Check whether a drop pincode is serviceable, and (cheaply) what
   * modes are available.
   *
   *   • GET `/c/api/pin-codes/json/?filter_codes={pincode}`.
   *   • `pre_paid === "Y"` -> prepaidAvailable
   *   • `cash === "Y"`     -> codAvailable
   *   • `pickup === "Y"`   -> reverseAvailable
   *   • Empty `delivery_codes` array -> serviceable=false.
   */
  async checkServiceability(pincode: string): Promise<ServiceabilityCheckResult> {
    if (!/^\d{6}$/.test(pincode)) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: `checkServiceability requires a 6-digit pincode (got "${pincode}").`,
        retryable: false,
      });
    }

    const response = await this.client.get<DelhiveryServiceabilityResponse>(
      DELHIVERY_PATHS.SERVICEABILITY,
      { filter_codes: pincode },
    );
    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }

    const body = response.body;
    const record: DelhiveryPincodeRecord | undefined =
      body?.delivery_codes?.[0]?.postal_code;
    if (!record) {
      return {
        pincode,
        serviceable: false,
        codAvailable: false,
        prepaidAvailable: false,
        reverseAvailable: false,
      };
    }
    return {
      pincode,
      serviceable: true,
      prepaidAvailable: yn(record.pre_paid),
      codAvailable: yn(record.cash),
      reverseAvailable: yn(record.pickup),
    };
  }

  /**
   * Heavy-product serviceability check (separate API). "NSZ" in the
   * response status indicates non-serviceable.
   */
  async checkHeavyServiceability(
    pincode: string,
  ): Promise<{
    pincode: string;
    serviceable: boolean;
    raw: DelhiveryHeavyServiceabilityResponse;
  }> {
    if (!/^\d{6}$/.test(pincode)) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: `checkHeavyServiceability requires a 6-digit pincode (got "${pincode}").`,
        retryable: false,
      });
    }
    const response = await this.client.get<DelhiveryHeavyServiceabilityResponse>(
      DELHIVERY_PATHS.HEAVY_SERVICEABILITY,
      { pincode: Number(pincode), product_type: 'Heavy' },
    );
    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }
    const body = response.body;
    const status = (body?.status ?? '').toString();
    return {
      pincode,
      serviceable: status.toUpperCase() !== 'NSZ',
      raw: body,
    };
  }

  /**
   * Expected TAT (turnaround time) between two pincodes for a given
   * mode of transport.
   */
  async getExpectedTat(input: {
    originPincode: string;
    destinationPincode: string;
    mot: DelhiveryMot;
    productType?: DelhiveryProductType;
    expectedPickupDate?: string; // "YYYY-MM-DD HH:mm"
  }): Promise<ExpectedTatResult> {
    const query: DelhiveryExpectedTatRequest = {
      origin_pin: input.originPincode,
      destination_pin: input.destinationPincode,
      mot: input.mot,
      pdt: input.productType,
      expected_pickup_date: input.expectedPickupDate,
    };
    const response = await this.client.get<DelhiveryExpectedTatResponse>(
      DELHIVERY_PATHS.EXPECTED_TAT,
      query as unknown as Record<string, unknown>,
    );
    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }
    const body = response.body;
    return {
      expectedDeliveryDate: body?.expected_delivery_date,
      tatDays:
        typeof body?.tat === 'number'
          ? body.tat
          : typeof body?.tat === 'string'
            ? Number(body.tat) || undefined
            : undefined,
      raw: body,
    };
  }

  /**
   * Get a live cost quote for a candidate shipment.
   *
   * GET `/api/kinko/v1/invoice/charges/.json` with the documented
   * query params. Multiplies the INR float by 100 to surface paise.
   */
  async calculateCost(input: CalculateCostInput): Promise<CalculateCostResult> {
    if (!Number.isInteger(input.weightGrams) || input.weightGrams <= 0) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'calculateCost: weightGrams must be a positive integer.',
        retryable: false,
      });
    }
    if (!/^\d{6}$/.test(input.originPincode) || !/^\d{6}$/.test(input.destinationPincode)) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'calculateCost: origin/destination must be 6-digit pincodes.',
        retryable: false,
      });
    }

    const req: DelhiveryCalculateCostRequest = {
      md: input.mode,
      cgm: input.weightGrams,
      o_pin: Number(input.originPincode),
      d_pin: Number(input.destinationPincode),
      ss: input.shipmentStatus ?? 'Delivered',
      pt: input.paymentType ?? 'Pre-paid',
      l: input.lengthCm,
      b: input.breadthCm,
      h: input.heightCm,
      ipkg_type: input.packageType,
    };

    const response = await this.client.get<DelhiveryCalculateCostResponse>(
      DELHIVERY_PATHS.CALCULATE_COST,
      req as unknown as Record<string, unknown>,
    );
    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }
    const body = response.body;
    const entry: DelhiveryCalculateCostResponseEntry = Array.isArray(body)
      ? (body[0] ?? {})
      : (body ?? {});

    const inrTotal = entry.total_amount ?? 0;
    if (!Number.isFinite(inrTotal)) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }

    return {
      pricePaise: BigInt(Math.round(inrTotal * 100)),
      inrTotal,
      zone: entry.zone,
      breakdown: entry,
    };
  }

  /**
   * Legacy port shim — kept narrow because the canonical
   * `CourierGatewayPort.getRate` predates the proper cost calculator.
   * Delegates to `calculateCost` with sensible defaults.
   */
  async getRate(input: {
    pickupPincode: string;
    dropPincode: string;
    weightGrams: number;
    cod: boolean;
    codAmountPaise?: bigint;
  }): Promise<{ pricePaise: bigint; etaDays: number | null }> {
    void input.codAmountPaise;
    const cost = await this.calculateCost({
      mode: 'S',
      originPincode: input.pickupPincode,
      destinationPincode: input.dropPincode,
      weightGrams: input.weightGrams,
      paymentType: input.cod ? 'COD' : 'Pre-paid',
      shipmentStatus: 'Delivered',
    });
    return { pricePaise: cost.pricePaise, etaDays: null };
  }
}

function yn(value: string | undefined): boolean {
  return (value ?? '').toUpperCase() === 'Y';
}
