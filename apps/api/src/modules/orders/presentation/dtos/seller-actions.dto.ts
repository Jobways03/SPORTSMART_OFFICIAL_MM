import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Phase 80 (2026-05-22) — acceptance audit Gap #16.
 *
 * Pre-Phase-80 the seller and franchise accept/reject endpoints
 * accepted inline TS-typed objects with no class-validator
 * decorators. `reason` could be any string (server stored it raw),
 * `note` had no length cap so an attacker could submit a 1 MB note,
 * `expectedDispatchDate` accepted any string and let it through to
 * `new Date(...)` which silently coerces garbage to Invalid Date.
 *
 * The DTOs below enforce all three at the pipe layer.
 */

export class SellerAcceptOrderDto {
  @IsOptional()
  @IsDateString(
    {},
    { message: 'expectedDispatchDate must be an ISO 8601 datetime' },
  )
  expectedDispatchDate?: string;
}

const REJECTION_REASONS = [
  'OUT_OF_STOCK',
  'CANNOT_SHIP',
  'LOCATION_ISSUE',
  'OTHER',
] as const;

export type SellerRejectionReason = (typeof REJECTION_REASONS)[number];

export class SellerRejectOrderDto {
  // Reason stays optional at the controller layer — the seller UI
  // pre-fills a dropdown but anonymous-cause rejects (e.g. via API
  // automation) shouldn't 400. If the seller does send one, it must
  // be one of the enum values; free strings are rejected.
  @IsOptional()
  @IsEnum(REJECTION_REASONS, {
    message: `reason must be one of ${REJECTION_REASONS.join(', ')}`,
  })
  reason?: SellerRejectionReason;

  // Length cap closes the "1 MB rejectionNote" DoS surface and the
  // XSS amplification (Gap #22). The admin UI escapes via React's
  // default rendering; the cap is defence-in-depth.
  @IsOptional()
  @IsString({ message: 'note must be a string' })
  @MaxLength(500, { message: 'note must be 500 characters or fewer' })
  note?: string;
}
