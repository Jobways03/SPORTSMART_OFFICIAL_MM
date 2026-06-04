import { IsEnum, IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { SettlementAdjustmentType } from '@prisma/client';

/**
 * Phase 177 (#4) — record an itemized adjustment against a PENDING franchise
 * settlement. `amount` is a SIGNED rupee string (negative = deduction from the
 * payout, positive = credit), bounded + 2-decimal so it can't carry an
 * injection payload or an absurd value.
 */
export class CreateFranchiseAdjustmentDto {
  @Matches(/^-?\d{1,9}(\.\d{1,2})?$/, {
    message: 'amount must be a signed rupee value with up to 2 decimals',
  })
  amount!: string;

  @IsEnum(SettlementAdjustmentType, {
    message: 'adjustmentType must be a valid SettlementAdjustmentType',
  })
  adjustmentType!: SettlementAdjustmentType;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'notes must be 500 characters or fewer' })
  @Matches(/^[\w\s.,:;!?@#&()\-/'"₹%+*=\n\r]*$/u, {
    message: 'notes contains unsupported characters',
  })
  notes?: string;
}
