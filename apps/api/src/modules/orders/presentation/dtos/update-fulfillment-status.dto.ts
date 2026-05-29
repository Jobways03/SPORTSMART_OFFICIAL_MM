import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Phase 82 (2026-05-23) — packing & shipping audit Gap #8/#9/#11.
 *
 * Pre-Phase-82 the seller and franchise update-status endpoints
 * accepted an inline `{ status: string; trackingNumber?: string;
 * courierName?: string }` with no class-validator decorators. A
 * status typo returned an opaque "Cannot transition from X to
 * SHIPED" 400. Tracking number was unbounded — a malicious seller
 * could store a 1 MB XSS payload. Courier name was free-text so
 * the same logical courier was stored as "DTDC", "dtdc",
 * "D.T.D.C." — analytics couldn't aggregate.
 *
 * The DTO enforces:
 *   • status: enum of the two values the seller/franchise can
 *     legally drive (PACKED / SHIPPED). DELIVERED + FULFILLED stay
 *     blocked at the service layer with explicit error messages
 *     so the client gets actionable feedback rather than a generic
 *     `@IsEnum` rejection.
 *   • trackingNumber: alphanumeric (with dashes), 8..30 chars. The
 *     pattern accepts every courier AWB format we ship through
 *     (BlueDart B-prefix, DTDC numeric, Delhivery alphanumeric,
 *     iThink AWBs).
 *   • courierName: capped at 64 chars; the recognised set is
 *     checked in `SUPPORTED_COURIERS` so analytics roll-up by
 *     canonical name; "OTHER" passes through as the escape hatch
 *     for couriers we haven't mapped yet.
 */

const ALLOWED_STATUSES = ['PACKED', 'SHIPPED'] as const;

export const SUPPORTED_COURIERS = [
  'DTDC',
  'DELHIVERY',
  'BLUEDART',
  'ECOM_EXPRESS',
  'XPRESSBEES',
  'INDIA_POST',
  'SHIPROCKET',
  'OTHER',
] as const;

export class UpdateFulfillmentStatusDto {
  @IsEnum(ALLOWED_STATUSES, {
    message: `status must be one of ${ALLOWED_STATUSES.join(', ')}`,
  })
  status!: 'PACKED' | 'SHIPPED';

  @IsOptional()
  @IsString({ message: 'trackingNumber must be a string' })
  @Matches(/^[A-Za-z0-9-]{8,30}$/, {
    message:
      'trackingNumber must be 8-30 chars, alphanumeric or dash only',
  })
  trackingNumber?: string;

  @IsOptional()
  @IsString({ message: 'courierName must be a string' })
  @MaxLength(64, { message: 'courierName must be 64 characters or fewer' })
  @IsIn(SUPPORTED_COURIERS as readonly string[], {
    message: `courierName must be one of ${SUPPORTED_COURIERS.join(', ')}`,
  })
  courierName?: string;
}

/**
 * Phase 82 — Gap #10. Build a customer-clickable tracking URL from
 * the (courier, trackingNumber) pair. Keeps the mapping in one
 * place so a new courier needs one entry here + one in
 * SUPPORTED_COURIERS.
 *
 * Returns null when the courier isn't mapped — the caller stores
 * null in `trackingUrl` and the customer order page falls back to
 * showing the raw AWB so the customer can paste it into the
 * courier's website manually.
 */
export function buildTrackingUrl(
  courier: string | null | undefined,
  awb: string | null | undefined,
): string | null {
  if (!courier || !awb) return null;
  const encoded = encodeURIComponent(awb);
  switch (courier.toUpperCase()) {
    case 'DTDC':
      return `https://www.dtdc.in/tracking/tracking_results.asp?strCnno=${encoded}`;
    case 'DELHIVERY':
      return `https://www.delhivery.com/track/package/${encoded}`;
    case 'BLUEDART':
      return `https://www.bluedart.com/tracking?trackFor=0&trackNo=${encoded}`;
    case 'ECOM_EXPRESS':
      return `https://www.ecomexpress.in/tracking/?awb_field=${encoded}`;
    case 'XPRESSBEES':
      return `https://www.xpressbees.com/shipment/tracking?trackid=${encoded}`;
    case 'INDIA_POST':
      return `https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx`;
    case 'SHIPROCKET':
      return `https://shiprocket.co/tracking/${encoded}`;
    default:
      return null;
  }
}
