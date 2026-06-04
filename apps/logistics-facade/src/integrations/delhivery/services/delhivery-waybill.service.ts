import { Inject, Injectable } from '@nestjs/common';
import { DelhiveryClient } from '../clients/delhivery.client';
import {
  DELHIVERY_CONFIG,
  DELHIVERY_FETCH_WAYBILL_MAX,
  DELHIVERY_PATHS,
} from '../delhivery.constants';
import type { DelhiveryConfig } from '../config/delhivery.config';
import type {
  DelhiveryFetchWaybillResponse,
} from '../dtos/delhivery-fetch-waybill.dto';
import { CarrierError } from './delhivery-order.service';
import { mapDelhiveryError } from '../mappers/delhivery-error.mapper';

/**
 * Delhivery Waybill (AWB) allocation surface.
 *
 *   • Bulk:    `GET /waybill/api/bulk/json/?count=<N>&cl=<client>`
 *   • Single:  `GET /waybill/api/fetch/json/?token=<token>`
 *
 * Bulk fetch consumes from the AWB pool and is rate-limited at 50,000
 * AWBs per 5-minute window (max 10,000 per call). Delhivery allocates
 * in batches of 25 on the backend.
 */
@Injectable()
export class DelhiveryWaybillService {
  constructor(
    private readonly client: DelhiveryClient,
    @Inject(DELHIVERY_CONFIG) private readonly config: DelhiveryConfig,
  ) {}

  /**
   * Fetch N AWBs in bulk from Delhivery's pool. Returns an ordered
   * list of allocated waybills.
   */
  async fetchBulk(count: number): Promise<string[]> {
    if (!Number.isInteger(count) || count <= 0 || count > DELHIVERY_FETCH_WAYBILL_MAX) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail:
          `fetchBulk: count must be an integer in [1, ${DELHIVERY_FETCH_WAYBILL_MAX}] ` +
          `(Delhivery's per-call cap).`,
        retryable: false,
      });
    }
    const response = await this.client.get<DelhiveryFetchWaybillResponse | string>(
      DELHIVERY_PATHS.FETCH_WAYBILL_BULK,
      { count, cl: this.config.clientName },
    );
    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }
    return parseWaybills(response.body);
  }

  /**
   * Fetch a single AWB via the dedicated single-fetch endpoint.
   * Used when Delhivery exposes a per-shipment token (rare; most
   * accounts only use bulk allocation).
   */
  async fetchSingle(token: string): Promise<string> {
    if (!token) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'fetchSingle requires a token.',
        retryable: false,
      });
    }
    const response = await this.client.get<DelhiveryFetchWaybillResponse | string>(
      DELHIVERY_PATHS.FETCH_WAYBILL_SINGLE,
      { token },
    );
    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }
    const list = parseWaybills(response.body);
    const first = list[0];
    if (!first) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }
    return first;
  }
}

/**
 * Delhivery's bulk-fetch endpoint returns either:
 *   • A quoted comma-separated string: `"123,456,789"`, or
 *   • A JSON envelope: `{ waybills: ["123","456","789"] }`,
 *   • A single-fetch envelope: `{ waybill: "123" }`.
 *
 * Normalise all three to `string[]`.
 */
function parseWaybills(body: unknown): string[] {
  if (typeof body === 'string') {
    return body
      .replace(/^"|"$/g, '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (body && typeof body === 'object') {
    const env = body as DelhiveryFetchWaybillResponse;
    if (Array.isArray(env.waybills)) return env.waybills;
    if (env.waybill) return [env.waybill];
  }
  return [];
}
