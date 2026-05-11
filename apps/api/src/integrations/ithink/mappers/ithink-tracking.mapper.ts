import type {
  IThinkTrackOrderRow,
  IThinkTrackScanDetail,
} from '../dtos/track-order.dto';

import {
  mapIThinkStatus,
  type ShipmentStatusInternal,
} from './ithink-status.mapper';

/**
 * Normalised tracking timeline emitted by the iThink integration into
 * the rest of the shipping module. Lets `IngestTrackingUpdateUseCase`
 * stay carrier-agnostic — when we add a second carrier later, the
 * adapter produces the same shape and downstream code is unchanged.
 */

export interface NormalisedScan {
  status: ShipmentStatusInternal;
  rawStatus: string;
  rawStatusCode: string;
  scanLocation: string;
  remark: string;
  scanAt: Date;
  reason?: string;
}

export interface NormalisedTracking {
  awb: string;
  courier: string;
  /** 'forward' | 'reverse'. Mirrors iThink's order_type. */
  direction: 'forward' | 'reverse';
  currentStatus: ShipmentStatusInternal;
  rawCurrentStatus: string;
  expectedDelivery?: Date;
  promiseDelivery?: Date;
  ofdCount: number;
  cancelStatus?: string;
  returnTrackingNo?: string;
  scans: NormalisedScan[];
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  // iThink uses 'YYYY-MM-DD HH:mm:ss' for scan timestamps and
  // 'YYYY-MM-DD' for ETA fields. Native Date parses both formats
  // by replacing space with 'T'.
  const normalised = value.includes(' ') ? value.replace(' ', 'T') : value;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function mapScan(scan: IThinkTrackScanDetail): NormalisedScan {
  return {
    status: mapIThinkStatus(scan.status),
    rawStatus: scan.status,
    rawStatusCode: scan.status_code,
    scanLocation: scan.scan_location,
    remark: scan.remark,
    scanAt: parseDate(scan.scan_date_time) ?? new Date(),
    reason: scan.status_reason || undefined,
  };
}

export function normaliseTracking(row: IThinkTrackOrderRow): NormalisedTracking {
  return {
    awb: row.awb_no,
    courier: row.logistic,
    direction: (row.order_type === 'reverse' ? 'reverse' : 'forward'),
    currentStatus: mapIThinkStatus(row.current_status),
    rawCurrentStatus: row.current_status,
    expectedDelivery: parseDate(row.expected_delivery_date),
    promiseDelivery:
      row.promise_delivery_date && row.promise_delivery_date !== '0000-00-00'
        ? parseDate(row.promise_delivery_date)
        : undefined,
    ofdCount: Number.parseInt(row.ofd_count, 10) || 0,
    cancelStatus: row.cancel_status || undefined,
    returnTrackingNo: row.return_tracking_no || undefined,
    scans: (row.scan_details ?? []).map(mapScan),
  };
}
