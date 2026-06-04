import { Injectable } from '@nestjs/common';
import { DelhiveryClient } from '../clients/delhivery.client';
import type { TrackingSnapshotResult } from '../../../modules/shipments/application/ports/outbound/courier-gateway.port';
import {
  DELHIVERY_PATHS,
  DELHIVERY_TRACK_MAX_AWBS,
} from '../delhivery.constants';
import type { DelhiveryTrackingResponse } from '../dtos/delhivery-tracking.dto';
import { toTrackingSnapshot } from '../mappers/delhivery-tracking.mapper';
import {
  CarrierError,
} from './delhivery-order.service';
import { mapDelhiveryError } from '../mappers/delhivery-error.mapper';

/**
 * Tracking surface — poll-based pull. The push-side (webhook
 * ingestion) lives in the `webhooks` module and reuses the same
 * mappers via `mappers/delhivery-tracking.mapper.ts`.
 */
@Injectable()
export class DelhiveryTrackingService {
  constructor(private readonly client: DelhiveryClient) {}

  /**
   * Pull the latest tracking snapshot for one or more AWBs.
   *
   *   • GET `/api/v1/packages/json/?waybill=<csv>` — Delhivery
   *     accepts up to 50 AWBs per call; the service chunks input.
   *   • For each Shipment record, build a TrackingSnapshotResult via
   *     `toTrackingSnapshot`.
   *   • Returns a Map keyed by AWB so the caller can detect missing
   *     AWBs (Delhivery silently omits unknown AWBs from the
   *     response).
   */
  async track(awbs: string[]): Promise<Map<string, TrackingSnapshotResult>> {
    return this.trackShipments(awbs);
  }

  /**
   * Public alias preferred by the adapter; kept distinct so unit
   * tests of the service surface a stable name. Splits the input
   * into <=50-AWB chunks and merges responses.
   */
  async trackShipments(
    awbs: string[],
  ): Promise<Map<string, TrackingSnapshotResult>> {
    if (!awbs || awbs.length === 0) return new Map();

    const result = new Map<string, TrackingSnapshotResult>();
    for (const chunk of chunkArray(awbs, DELHIVERY_TRACK_MAX_AWBS)) {
      const response = await this.client.get<DelhiveryTrackingResponse>(
        DELHIVERY_PATHS.TRACK,
        { waybill: chunk.join(',') },
      );
      if (response.status < 200 || response.status >= 300) {
        throw new CarrierError(
          mapDelhiveryError(response.status, response.body),
        );
      }
      const body = response.body;
      for (const entry of body?.ShipmentData ?? []) {
        const shipment = entry.Shipment;
        if (!shipment?.AWB) continue;
        result.set(shipment.AWB, toTrackingSnapshot(shipment));
      }
    }
    return result;
  }

  /**
   * Lookup tracking by caller order ID instead of AWB. Delhivery's
   * tracking endpoint accepts `?ref_ids=<csv>` as an alternative
   * key.
   */
  async trackByRefIds(
    refIds: string[],
  ): Promise<Map<string, TrackingSnapshotResult>> {
    if (!refIds || refIds.length === 0) return new Map();

    const result = new Map<string, TrackingSnapshotResult>();
    for (const chunk of chunkArray(refIds, DELHIVERY_TRACK_MAX_AWBS)) {
      const response = await this.client.get<DelhiveryTrackingResponse>(
        DELHIVERY_PATHS.TRACK,
        { ref_ids: chunk.join(',') },
      );
      if (response.status < 200 || response.status >= 300) {
        throw new CarrierError(
          mapDelhiveryError(response.status, response.body),
        );
      }
      for (const entry of response.body?.ShipmentData ?? []) {
        const shipment = entry.Shipment;
        if (!shipment?.AWB) continue;
        result.set(shipment.AWB, toTrackingSnapshot(shipment));
      }
    }
    return result;
  }

  /**
   * Convenience helper — returns the snapshot for a single AWB.
   * Throws CarrierError(AWB_NOT_FOUND) when Delhivery omits the AWB.
   */
  async getTimeline(awb: string): Promise<TrackingSnapshotResult> {
    const snapshots = await this.trackShipments([awb]);
    const snap = snapshots.get(awb);
    if (!snap) {
      throw new CarrierError({
        code: 'AWB_NOT_FOUND',
        detail: `Delhivery has no tracking record for AWB ${awb}.`,
        retryable: false,
      });
    }
    return snap;
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
