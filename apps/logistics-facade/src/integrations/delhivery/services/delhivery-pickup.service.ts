import { Injectable } from '@nestjs/common';
import { DelhiveryClient } from '../clients/delhivery.client';
import { DELHIVERY_PATHS } from '../delhivery.constants';
import type {
  DelhiveryPickupRequestRequest,
  DelhiveryPickupRequestResponse,
} from '../dtos/delhivery-pickup-request.dto';
import { CarrierError } from './delhivery-order.service';
import { mapDelhiveryError } from '../mappers/delhivery-error.mapper';

export interface CreatePickupRequestInput {
  /** Warehouse name registered in the Delhivery One panel. */
  warehouseName: string;
  /** "YYYY-MM-DD". */
  date: string;
  /** "HH:MM:SS" (24h). */
  time: string;
  /** Positive integer — expected package count. */
  expectedPackageCount: number;
}

export interface CreatePickupRequestResult {
  pickupId: string;
  success: boolean;
  raw: DelhiveryPickupRequestResponse;
}

/**
 * Delhivery Pickup Request surface.
 *
 *   • `POST /fm/request/new/` — raise a new pickup request for a
 *     warehouse on a given date/time.
 *   • One pickup request per warehouse per day until the previous one
 *     closes. Duplicate raises are rejected — the error mapper surfaces
 *     those as BUSY.
 *
 * Pickup requests are NOT bound to individual AWBs — they are warehouse
 * + date + expected count tuples. The waybills become attached to the
 * pickup when Delhivery's rider scans them on collection.
 */
@Injectable()
export class DelhiveryPickupService {
  constructor(private readonly client: DelhiveryClient) {}

  async createPickupRequest(
    input: CreatePickupRequestInput,
  ): Promise<CreatePickupRequestResult> {
    if (!input.warehouseName?.trim()) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'createPickupRequest requires warehouseName.',
        retryable: false,
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'createPickupRequest: date must be "YYYY-MM-DD".',
        retryable: false,
      });
    }
    if (!/^\d{2}:\d{2}:\d{2}$/.test(input.time)) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'createPickupRequest: time must be "HH:MM:SS".',
        retryable: false,
      });
    }
    if (!Number.isInteger(input.expectedPackageCount) || input.expectedPackageCount <= 0) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'createPickupRequest: expectedPackageCount must be a positive integer.',
        retryable: false,
      });
    }

    const body: DelhiveryPickupRequestRequest = {
      pickup_time: input.time,
      pickup_date: input.date,
      pickup_location: input.warehouseName,
      expected_package_count: input.expectedPackageCount,
    };

    const response = await this.client.post<
      DelhiveryPickupRequestRequest,
      DelhiveryPickupRequestResponse | unknown
    >(DELHIVERY_PATHS.PICKUP_REQUEST, body, {
      contentType: 'json',
      idempotencyKey: `pickup-${input.warehouseName}-${input.date}`,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }
    const envelope = response.body as DelhiveryPickupRequestResponse;
    const pickupId = envelope?.pickup_id;
    if (!pickupId) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }
    return {
      pickupId: String(pickupId),
      success: true,
      raw: envelope,
    };
  }
}
