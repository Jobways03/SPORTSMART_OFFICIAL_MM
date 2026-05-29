import { IsInt, IsString, IsUUID, Length, Max, Min } from 'class-validator';

/**
 * Phase 150 — manual seller-debit entry. Finance records a goodwill / off-
 * platform claw-back by hand (e.g. a chargeback the automated reversal can't
 * see). Source type is fixed to MANUAL server-side; the row is netted off the
 * seller's next settlement cycle exactly like an automated claw-back.
 */
export class CreateManualSellerDebitDto {
  @IsUUID()
  sellerId!: string;

  /** Positive paise, bounded ₹0.01 .. ₹10,00,000 (safe within JS number). */
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountInPaise!: number;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

/** Phase 150 — cancel a PENDING seller debit (seller successfully contested). */
export class CancelSellerDebitDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}
