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
  IsIn,
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

// Phase 174 — coerce optional numeric query params without class-transformer's
// @Type (which needs reflect-metadata at decoration time; @Transform does not,
// keeping these DTOs loadable in any context). undefined/''/null -> undefined
// (so @IsOptional short-circuits); anything else -> Number (NaN -> @IsInt 400).
const toOptionalInt = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === ''
    ? undefined
    : Number(value);

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

/**
 * Phase 174 (audit #226) — optional rescore reason, validated when present
 * and audited (old->new band) on the resulting audit_logs row.
 */
export class RescoreOrderDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(3, 500, { message: 'reason must be 3-500 characters' })
  reason?: string;
}

/**
 * Phase 174 (audit #227) — optionally claim the next order of a specific
 * band ("claim next RED") instead of the oldest unclaimed regardless of risk.
 */
export class ClaimNextDto {
  @IsOptional()
  @IsIn(['GREEN', 'YELLOW', 'RED', 'CRITICAL'], {
    message: 'band must be one of GREEN, YELLOW, RED, CRITICAL',
  })
  band?: 'GREEN' | 'YELLOW' | 'RED' | 'CRITICAL';
}

/**
 * Phase 174 (audit #225) — backfill controls: dry-run preview + bounded
 * batch so a 100k-order backlog can't block the request for minutes.
 */
export class BackfillScoresDto {
  @IsOptional()
  @IsBoolean({ message: 'dryRun must be a boolean' })
  dryRun?: boolean;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(5000, { message: 'limit must be at most 5000' })
  limit?: number;
}

/**
 * Phase 174 (audit #227) — band-filtered, paginated verification-queue list.
 * `band`: RED | YELLOW | GREEN | CRITICAL | HIGH (RED+CRITICAL) | RED_YELLOW
 * (non-green/non-null) | UNSCORED | ALL.
 */
export class ListVerificationOrdersDto {
  @IsOptional()
  @IsIn(
    ['RED', 'YELLOW', 'GREEN', 'CRITICAL', 'HIGH', 'RED_YELLOW', 'UNSCORED', 'ALL'],
    {
      message:
        'band must be RED, YELLOW, GREEN, CRITICAL, HIGH, RED_YELLOW, UNSCORED, or ALL',
    },
  )
  band?:
    | 'RED'
    | 'YELLOW'
    | 'GREEN'
    | 'CRITICAL'
    | 'HIGH'
    | 'RED_YELLOW'
    | 'UNSCORED'
    | 'ALL';

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  onlyUnclaimed?: boolean;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page?: number;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit must be at most 100' })
  limit?: number;
}
