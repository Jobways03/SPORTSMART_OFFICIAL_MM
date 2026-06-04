// Phase 242 (POS Reconciliation audit) — franchise submits the day's counted
// cash + bank deposit. The server recomputes EXPECTED cash authoritatively and
// derives the variance; the client never sends an expected/variance value.
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PosSubmitReconciliationDto {
  @IsDateString({}, { message: 'businessDate must be an ISO date (YYYY-MM-DD)' })
  businessDate!: string;

  // Physically counted cash in the drawer, in paise.
  @IsInt({ message: 'actualCashInPaise must be an integer (paise)' })
  @Min(0, { message: 'actualCashInPaise must be >= 0' })
  @Max(100_000_000_000, { message: 'actualCashInPaise is implausibly large' })
  actualCashInPaise!: number;

  // Amount deposited to the bank, in paise (optional; defaults to 0).
  @IsOptional()
  @IsInt({ message: 'bankDepositInPaise must be an integer (paise)' })
  @Min(0, { message: 'bankDepositInPaise must be >= 0' })
  @Max(100_000_000_000, { message: 'bankDepositInPaise is implausibly large' })
  bankDepositInPaise?: number;

  // Bank UTR / deposit-slip reference.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9\-_/ ]*$/, {
    message: 'bankDepositReference may only contain letters, digits, spaces and - _ /',
  })
  bankDepositReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
