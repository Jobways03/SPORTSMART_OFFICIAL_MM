import type {
  NormalisedScanRecord,
  TrackingSnapshotResult,
} from '../../../modules/shipments/application/ports/outbound/courier-gateway.port';
import type {
  DelhiveryShipmentRecord,
  DelhiveryScanRecord,
} from '../dtos/delhivery-tracking.dto';
import { mapDelhiveryStatus } from './delhivery-status.mapper';
import { DELHIVERY_PARTNER_CODE } from '../delhivery.constants';

/**
 * Translate a single Delhivery scan into the carrier-neutral
 * `NormalisedScanRecord` consumed by the tracking service.
 *
 *   • partnerStatusCode prefers `StatusCode` -> `Scan` -> `ScanType`.
 *   • Delhivery emits `ScanDateTime` as "YYYY-MM-DDTHH:mm:ss" (IST,
 *     no offset). We parse with `Date()` and tag IST by appending
 *     "+05:30" if the string doesn't already carry a TZ — keeping
 *     the comparison correct across UTC boundaries.
 */
export function toNormalisedScan(raw: DelhiveryScanRecord): NormalisedScanRecord {
  const partnerCode = raw.StatusCode ?? raw.Scan ?? raw.ScanType ?? '';
  const normalizedStatus = mapDelhiveryStatus({
    statusCode: raw.StatusCode,
    status: raw.Scan,
    scan: raw.ScanType,
  });
  return {
    partnerStatusCode: partnerCode,
    normalizedStatus,
    location: raw.ScannedLocation,
    remark: raw.Instructions,
    eventAt: parseDelhiveryDateTime(raw.ScanDateTime),
  };
}

/**
 * Build the carrier-neutral `TrackingSnapshotResult` from Delhivery's
 * `Shipment` block.
 *
 *   • currentNormalizedStatus uses the top-level `Status.StatusCode`,
 *     falling back to the latest scan if missing.
 *   • events[] is emitted in input order (Delhivery typically sends
 *     ascending by scan time).
 *   • direction defaults to forward unless `Origin === "Reverse"`.
 */
export function toTrackingSnapshot(
  record: DelhiveryShipmentRecord,
): TrackingSnapshotResult {
  const events = (record.Scans ?? [])
    .map((s) => s.ScanDetail)
    .filter((s): s is DelhiveryScanRecord => !!s)
    .map(toNormalisedScan);

  const topLevelStatus = mapDelhiveryStatus({
    statusCode: record.Status?.StatusCode,
    status: record.Status?.Status,
  });

  const lastEvent = events.length > 0 ? events[events.length - 1] : undefined;
  const currentNormalizedStatus =
    topLevelStatus !== 'EXCEPTION'
      ? topLevelStatus
      : lastEvent
        ? lastEvent.normalizedStatus
        : 'EXCEPTION';

  return {
    awb: record.AWB,
    partner: DELHIVERY_PARTNER_CODE,
    direction: record.Origin === 'Reverse' ? 'reverse' : 'forward',
    currentNormalizedStatus,
    expectedDeliveryAt: record.ExpectedDeliveryDate
      ? parseDelhiveryDateTime(record.ExpectedDeliveryDate)
      : undefined,
    events,
  };
}

/**
 * Delhivery emits ISO-ish "YYYY-MM-DDTHH:mm:ss" strings without a TZ
 * offset (IST is implied). Append "+05:30" so `Date` parses correctly
 * across UTC boundaries. Strings that already carry a TZ are passed
 * through.
 */
function parseDelhiveryDateTime(input: string | undefined): Date {
  if (!input) return new Date(0);
  const trimmed = input.trim();
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) return new Date(trimmed);
  // "YYYY-MM-DDTHH:mm:ss" → append IST offset.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}+05:30`);
  }
  // Best effort — let Date parse what it can.
  return new Date(trimmed);
}
