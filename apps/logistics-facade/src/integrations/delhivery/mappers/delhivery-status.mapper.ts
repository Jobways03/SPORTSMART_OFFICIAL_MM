import type { NormalizedStatus } from '@sportsmart/logistics-contracts';
import { DELHIVERY_STATUS_PREFIXES } from '../delhivery.constants';

/**
 * Translate a Delhivery scan record (Status + StatusCode + Scan) into
 * one of the canonical `NormalizedStatus` values from
 * `@sportsmart/logistics-contracts/tracking`.
 *
 * Unknown codes MUST NOT silently map to `EXCEPTION` — the mapper
 * logs the raw code (via the optional `onUnknown` callback) and
 * returns `EXCEPTION` so ops can grep the logs and extend the
 * dictionary.
 *
 * Pattern mirrors apps/api/src/integrations/ithink/mappers/ithink-status.mapper.ts.
 */

export interface DelhiveryRawStatus {
  status?: string;
  statusCode?: string;
  scan?: string;
}

/**
 * Dictionary built from the Delhivery integration guide. Keys are
 * compared case-insensitively against `Status` -> `Scan` -> `ScanType`,
 * picking the most specific match.
 */
const STATUS_MAP: ReadonlyArray<{
  match: RegExp;
  normalized: NormalizedStatus;
}> = [
  { match: /^manifested/i, normalized: 'BOOKED' },
  { match: /not\s*picked/i, normalized: 'PICKUP_SCHEDULED' },
  { match: /pickup\s*scheduled/i, normalized: 'PICKUP_SCHEDULED' },
  { match: /pending/i, normalized: 'IN_TRANSIT' },
  { match: /reached\s+at\s+/i, normalized: 'ARRIVED_AT_HUB' },
  { match: /dispatched/i, normalized: 'IN_TRANSIT' },
  { match: /in\s*transit/i, normalized: 'IN_TRANSIT' },
  { match: /out\s*for\s*delivery/i, normalized: 'OUT_FOR_DELIVERY' },
  { match: /delivered/i, normalized: 'DELIVERED' },
  { match: /undelivered/i, normalized: 'NDR' },
  { match: /not\s*attempted/i, normalized: 'NDR_NOT_ATTEMPTED' },
  { match: /not\s*contactable/i, normalized: 'NDR_NOT_CONTACTABLE' },
  { match: /re-?attempt/i, normalized: 'REATTEMPT_SCHEDULED' },
  { match: /on\s*hold/i, normalized: 'ON_HOLD' },
  { match: /delayed/i, normalized: 'DELAYED' },
  { match: /misrouted/i, normalized: 'MISROUTED' },
  { match: /rto\s*initiated/i, normalized: 'RTO_INITIATED' },
  { match: /rto\s*in\s*transit/i, normalized: 'RTO_IN_TRANSIT' },
  { match: /rto\s*delivered/i, normalized: 'RTO_DELIVERED' },
  { match: /^rto/i, normalized: 'RTO_INITIATED' },
  { match: /(cancel|canceled|cancelled)/i, normalized: 'CANCELLED' },
  { match: /lost/i, normalized: 'LOST' },
  { match: /damaged/i, normalized: 'DAMAGED' },
];

export function mapDelhiveryStatus(
  raw: DelhiveryRawStatus,
  onUnknown?: (raw: DelhiveryRawStatus) => void,
): NormalizedStatus {
  void DELHIVERY_STATUS_PREFIXES; // kept exported for consumers; not used here directly
  const candidates: string[] = [
    raw.statusCode ?? '',
    raw.status ?? '',
    raw.scan ?? '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    for (const entry of STATUS_MAP) {
      if (entry.match.test(candidate)) return entry.normalized;
    }
  }

  if (onUnknown) onUnknown(raw);
  return 'EXCEPTION';
}
