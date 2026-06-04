import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import type { PaymentMismatchStatus } from '@prisma/client';

const STATUSES: PaymentMismatchStatus[] = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'IGNORED'];

/**
 * Phase 169 — replaces the inline `interface TransitionDto` (no validation).
 * `expectedFromStatus` powers the CAS guard (#5): the row must still be in the
 * status the admin last saw, else 409-style concurrent-modification.
 */
export class TransitionAlertDto {
  @IsIn(STATUSES, { message: 'status must be one of OPEN/IN_REVIEW/RESOLVED/IGNORED' })
  status!: PaymentMismatchStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsIn(STATUSES)
  expectedFromStatus?: PaymentMismatchStatus;
}

/** Phase 169 (#16) — bulk transition. */
export class BulkTransitionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids!: string[];

  @IsIn(STATUSES)
  status!: PaymentMismatchStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Phase 169 (#1/#2) — submit chargeback contest evidence. */
export class ChargebackEvidenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
