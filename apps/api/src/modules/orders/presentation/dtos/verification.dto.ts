// Phase 68 (2026-05-22) — DTOs for the order-verification queue
// surface (audit Gap #18). Pre-Phase-68 every endpoint accepted
// inline `body: { … }` shapes with no class-validator coverage:
//   • `remarks` had no length cap (XSS / DoS via huge string)
//   • `reason` was only ad-hoc checked for `>= 3 chars` in the
//     service layer — no max
//   • `limit` was Number()-coerced and only clamped server-side at
//     25; a malformed string slipped through to NaN handling
//   • `dryRun` was a loose truthy check
//
// All DTOs trim and normalise inputs at the pipe layer so the
// service receives a known-good shape.

import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class VerifyOrderDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500, { message: 'remarks must not exceed 500 characters' })
  remarks?: string;
}

export class ApproveOrderDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500, { message: 'remarks must not exceed 500 characters' })
  remarks?: string;
}

export class RejectOrderDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500, { message: 'remarks must not exceed 500 characters' })
  remarks?: string;
}

export class ForceReleaseDto {
  @IsString({ message: 'reason is required' })
  @Transform(trim)
  @Length(3, 500, { message: 'reason must be 3-500 characters' })
  reason!: string;
}

/**
 * Phase 74 (2026-05-22) — Phase 73 approve/reject audit Gap #2 + #19.
 *
 * Pre-Phase-74 the /admin/orders/:id/reject-order endpoint accepted
 * NO body — the UI sent nothing, the service stored nothing, and
 * the resulting CANCELLED order had no rejecter, no reason, no
 * audit trail. This DTO forces the caller to supply a meaningful
 * reason (10..500 chars after trim) before the reject runs.
 */
export class RejectOrderBodyDto {
  @IsString({ message: 'reason is required' })
  @Transform(trim)
  @Length(10, 500, { message: 'reason must be 10-500 characters' })
  reason!: string;
}

export class BulkApproveGreenDto {
  // Server still hard-clamps at VERIFICATION_BULK_APPROVE_MAX
  // (env-driven, default 25, absolute ceiling 50) — the @Max
  // mirrors the absolute ceiling so a misbehaving client gets a
  // clear 400 instead of silent clamping. @Min 1 rejects 0/negative.
  //
  // Phase 76 (audit Gap #16) — bumped DTO max to 50 to allow
  // env-tunable scale. The service clamps to the actual configured
  // value at request time.
  @IsOptional()
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(50, { message: 'limit must be at most 50' })
  limit?: number;

  @IsOptional()
  @IsBoolean({ message: 'dryRun must be a boolean' })
  dryRun?: boolean;
}
