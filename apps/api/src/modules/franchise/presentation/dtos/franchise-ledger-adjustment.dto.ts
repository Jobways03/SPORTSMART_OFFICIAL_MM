import { IsNotEmpty, IsNumber, IsString, MinLength, MaxLength, Min, Max, Matches } from 'class-validator';

export class FranchiseLedgerAdjustmentDto {
  @IsNotEmpty({ message: 'Amount is required' })
  // Phase 181 (#7/#15) — bounded, ≤2 decimals (positive = credit, negative = debit).
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Amount must be a number with at most 2 decimals' })
  @Min(-100000000, { message: 'Amount is out of range' })
  @Max(100000000, { message: 'Amount is out of range' })
  amount!: number;

  @IsNotEmpty({ message: 'Reason is required' })
  @IsString({ message: 'Reason must be a string' })
  @MinLength(5, { message: 'Reason must be at least 5 characters' })
  @MaxLength(500, { message: 'Reason must not exceed 500 characters' })
  // Phase 181 (#15) — charset guard (blocks markup/control chars that could
  // become an XSS/formula payload in a future PDF/email/CSV render).
  @Matches(/^[\w\s.,!?():@/\-\n₹%+*='"&#]*$/u, { message: 'Reason contains unsupported characters' })
  reason!: string;
}
