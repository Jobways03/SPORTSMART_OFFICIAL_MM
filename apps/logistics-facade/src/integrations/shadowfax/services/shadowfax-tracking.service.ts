import { Injectable } from '@nestjs/common';
import type { CanonicalTrackingTimeline } from '@sportsmart/logistics-contracts';
import { ShadowfaxClient } from '../clients/shadowfax.client';
import {
  isShadowfaxBulkTrackSuccess,
  isShadowfaxTrackOrderSuccess,
  type ShadowfaxBulkTrackResponse,
  type ShadowfaxTrackOrderResponse,
} from '../dtos/shadowfax-tracking.dto';
import {
  fromShadowfaxBulkTrackingResponse,
  fromShadowfaxTrackingResponse,
} from '../mappers/shadowfax-tracking.mapper';
import { mapShadowfaxError } from '../mappers/shadowfax-error.mapper';
import { CarrierError } from './shadowfax-order.service';
import {
  SHADOWFAX_BULK_TRACK_MAX_AWBS,
  SHADOWFAX_PATHS,
} from '../shadowfax.constants';

/**
 * Tracking pull surface for Shadowfax. Two endpoints:
 *   • Single:  `GET /v4/clients/orders/{awb_number}/track/`
 *   • Bulk:    `POST /v4/clients/bulk_track/` (max 50 AWBs per call)
 *
 * Webhook ingestion lives in the `webhooks` module and reuses the
 * same `shadowfax-tracking.mapper.ts` translator so the canonical
 * shape is identical between push + pull.
 *
 * Errors are routed through `CarrierError` via `mapShadowfaxError`
 * so the rest of the facade sees a consistent error envelope.
 */
@Injectable()
export class ShadowfaxTrackingService {
  constructor(private readonly client: ShadowfaxClient) {}

  /**
   * Pull a single shipment's tracking timeline.
   *
   * Throws `CarrierError` with:
   *   • UNAUTHORIZED on 401
   *   • AWB_NOT_FOUND when the partner replies "Invalid AWB number"
   *   • PARTNER_DOWN on 5xx
   *   • VALIDATION_FAILED for other 400s
   */
  async getOrderTracking(awb: string): Promise<CanonicalTrackingTimeline> {
    const trimmed = awb?.trim();
    if (!trimmed) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'getOrderTracking awb is required.',
        retryable: false,
      });
    }

    const path = SHADOWFAX_PATHS.TRACK_BY_AWB.replace(
      '{awb}',
      encodeURIComponent(trimmed),
    );

    const response = await this.client.get<ShadowfaxTrackOrderResponse>(path);

    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapShadowfaxError(response.status, response.body));
    }

    if (!isShadowfaxTrackOrderSuccess(response.body)) {
      throw new CarrierError(mapShadowfaxError(400, response.body));
    }

    return fromShadowfaxTrackingResponse(response.body);
  }

  /**
   * Pull tracking timelines for many AWBs in one logical operation.
   *
   * The partner caps each bulk request at 50 AWBs, so we split the
   * input into chunks and merge the results. The first chunk that
   * fails surfaces the error; partial-success semantics are NOT
   * supported in v1 (intentional — bulk track is used by the
   * reconciliation cron, which prefers fail-fast).
   */
  async getOrdersTracking(
    awbs: string[],
  ): Promise<Map<string, CanonicalTrackingTimeline>> {
    const out = new Map<string, CanonicalTrackingTimeline>();
    const unique = Array.from(new Set(awbs.map((a) => a?.trim()).filter(Boolean))) as string[];
    if (unique.length === 0) return out;

    for (let i = 0; i < unique.length; i += SHADOWFAX_BULK_TRACK_MAX_AWBS) {
      const chunk = unique.slice(i, i + SHADOWFAX_BULK_TRACK_MAX_AWBS);
      const response = await this.client.post<
        { awb_numbers: string[] },
        ShadowfaxBulkTrackResponse
      >(SHADOWFAX_PATHS.BULK_TRACK, { awb_numbers: chunk });

      if (response.status < 200 || response.status >= 300) {
        throw new CarrierError(mapShadowfaxError(response.status, response.body));
      }

      if (!isShadowfaxBulkTrackSuccess(response.body)) {
        throw new CarrierError(mapShadowfaxError(400, response.body));
      }

      const chunkResults = fromShadowfaxBulkTrackingResponse(response.body);
      for (const [awb, timeline] of chunkResults) {
        out.set(awb, timeline);
      }
    }

    return out;
  }
}
