import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
} from 'class-validator';
import { SettlementAdjustmentType } from '@prisma/client';

/**
 * Phase 141 — runtime validation for cycle create/preview. Previously an inline
 * `{ periodStart: string; periodEnd: string }` interface with hand-rolled
 * controller checks. The controller additionally enforces start < end, a
 * max-window cap, and converts the dates to Asia/Kolkata day boundaries.
 */
export class CreateCycleDto {
  @IsISO8601()
  periodStart!: string;

  @IsISO8601()
  periodEnd!: string;
}

export class CancelCycleDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ApproveCycleDto {
  // Phase 144 — optional free-text rationale stamped on the cycle's approval
  // audit columns. Service HTML-strips + caps at 500 chars.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class MarkPaidDto {
  // Phase 145 — bank UTR / gateway payout reference. Alphanumeric + _ - only:
  // covers NEFT/RTGS UTRs (12-22 alnum) and gateway payout IDs (pout_…), and is
  // inherently XSS-safe (no markup chars) for CSV/email surfaces.
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,40}$/, {
    message: 'utrReference must be 8-40 chars (letters, digits, _ or -)',
  })
  utrReference!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  paymentMethod?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  paymentProofUrl?: string;
}

export class MarkFailedDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class CreateAdjustmentDto {
  // Phase 147 — bounded, non-zero, ≤2dp. positive adds to payout, negative deducts.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-1_000_000)
  @Max(1_000_000)
  @NotEquals(0)
  amount!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsEnum(SettlementAdjustmentType)
  adjustmentType?: SettlementAdjustmentType;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  referenceDocumentUrl?: string;
}

export class VoidAdjustmentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  voidReason!: string;
}
