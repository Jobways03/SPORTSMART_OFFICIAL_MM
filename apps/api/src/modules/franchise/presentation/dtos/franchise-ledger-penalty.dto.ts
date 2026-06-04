import { IsNotEmpty, IsNumber, IsString, IsOptional, Min, Max, MinLength, MaxLength, Matches } from 'class-validator';

export class FranchiseLedgerPenaltyDto {
  @IsNotEmpty({ message: 'Amount is required' })
  // Phase 181 (#7/#15) — positive, bounded, ≤2 decimals.
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Amount must be a number with at most 2 decimals' })
  @Min(0.01, { message: 'Amount must be at least 0.01' })
  @Max(100000000, { message: 'Amount is out of range' })
  amount!: number;

  @IsNotEmpty({ message: 'Reason is required' })
  @IsString({ message: 'Reason must be a string' })
  @MinLength(5, { message: 'Reason must be at least 5 characters' })
  @MaxLength(500, { message: 'Reason must not exceed 500 characters' })
  @Matches(/^[\w\s.,!?():@/\-\n₹%+*='"&#]*$/u, { message: 'Reason contains unsupported characters' })
  reason!: string;

  // Phase 181 (#11) — a high-value penalty (above the env threshold) must be
  // co-acknowledged: this carries a SECOND admin's id (≠ the actor). Enforced
  // in the controller; recorded for audit. Optional for sub-threshold penalties.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[\w-]+$/, { message: 'coApproverAdminId is malformed' })
  coApproverAdminId?: string;
}
