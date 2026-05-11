import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { IThinkClient } from '../clients/ithink.client';
import { ITHINK_BATCH_LIMITS } from '../ithink.constants';
import type {
  IThinkTrackOrderRequest,
  IThinkTrackOrderResponseData,
} from '../dtos/track-order.dto';
import type {
  IThinkGetAirwaybillRequest,
  IThinkGetAirwaybillResponse,
} from '../dtos/get-airwaybill.dto';
import {
  normaliseTracking,
  type NormalisedTracking,
} from '../mappers/ithink-tracking.mapper';

/**
 * Tracking endpoints — Track Order (on-demand per AWB) and Get
 * Airwaybill (status-change firehose, polled by cron).
 *
 * Track Order uses a different production host than the rest of the
 * iThink API; the client routes via `ITHINK_TRACK_URL` so the service
 * doesn't need to know.
 */
@Injectable()
export class IThinkTrackingService {
  private readonly logger = new Logger(IThinkTrackingService.name);

  constructor(private readonly client: IThinkClient) {}

  /**
   * Fetch the full scan history for a small batch of AWBs. iThink caps
   * the request at 10 AWBs — callers passing more should batch via
   * `trackBatched`.
   */
  async track(awbs: string[]): Promise<Map<string, NormalisedTracking>> {
    if (awbs.length === 0) return new Map();
    if (awbs.length > ITHINK_BATCH_LIMITS.TRACK_ORDER_AWBS) {
      throw new BadRequestException(
        `Track Order accepts max ${ITHINK_BATCH_LIMITS.TRACK_ORDER_AWBS} AWBs per call; got ${awbs.length}`,
      );
    }

    const body: IThinkTrackOrderRequest = { awb_number_list: awbs.join(',') };
    const response = await this.client.post<IThinkTrackOrderResponseData>(
      'TRACK_ORDER',
      body as unknown as Record<string, unknown>,
    );

    const data = response.data ?? {};
    const result = new Map<string, NormalisedTracking>();
    for (const [awb, row] of Object.entries(data)) {
      result.set(awb, normaliseTracking(row));
    }
    return result;
  }

  /**
   * Convenience for callers with arbitrary-size AWB lists. Splits into
   * 10-AWB chunks, calls Track Order serially (parallel calls risk
   * hitting iThink's per-account QPS cap), and returns the merged map.
   */
  async trackBatched(awbs: string[]): Promise<Map<string, NormalisedTracking>> {
    const merged = new Map<string, NormalisedTracking>();
    const chunkSize = ITHINK_BATCH_LIMITS.TRACK_ORDER_AWBS;
    for (let i = 0; i < awbs.length; i += chunkSize) {
      const chunk = awbs.slice(i, i + chunkSize);
      const chunkResult = await this.track(chunk);
      for (const [awb, tracking] of chunkResult) merged.set(awb, tracking);
    }
    return merged;
  }

  /**
   * The status-change firehose. Returns the AWBs whose status updated
   * in the given window. iThink caps the window to ≤30 min so the
   * tracking poller cron must use a tight cadence (~25 min).
   *
   * Caller is responsible for advancing the window after each call to
   * avoid duplicate events.
   */
  async getAirwaybillsChanged(input: {
    startDateTime: Date;
    endDateTime: Date;
  }): Promise<string[]> {
    const windowMs = input.endDateTime.getTime() - input.startDateTime.getTime();
    const maxWindowMs = ITHINK_BATCH_LIMITS.GET_AIRWAYBILL_WINDOW_MINUTES * 60_000;
    if (windowMs > maxWindowMs) {
      throw new BadRequestException(
        `Get Airwaybill window must be ≤${ITHINK_BATCH_LIMITS.GET_AIRWAYBILL_WINDOW_MINUTES} minutes`,
      );
    }
    if (windowMs <= 0) {
      throw new BadRequestException('Get Airwaybill window must be positive');
    }

    const body: IThinkGetAirwaybillRequest = {
      start_date_time: formatYMDHMS(input.startDateTime),
      end_date_time: formatYMDHMS(input.endDateTime),
    };

    // Get Airwaybill's response shape doesn't follow the standard
    // envelope (no `data`, uses 'Awb list' as a top-level field).
    const response = (await this.client.post<unknown>(
      'GET_AIRWAYBILL',
      body as unknown as Record<string, unknown>,
    )) as unknown as IThinkGetAirwaybillResponse;

    const list = response['Awb list'] ?? [];
    const awbs = list.map((entry) => entry.airway_bill_no).filter(Boolean);

    this.logger.debug(
      `Get Airwaybill window ${body.start_date_time}..${body.end_date_time} returned ${awbs.length} AWB(s)`,
    );
    return awbs;
  }
}

/**
 * Format a Date as 'YYYY-MM-DD HH:mm:ss' (iThink's local-time format).
 * iThink does not specify a timezone — operate in their assumed IST.
 */
function formatYMDHMS(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
