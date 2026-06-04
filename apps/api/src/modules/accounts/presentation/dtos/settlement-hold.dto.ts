import { IsBoolean, IsOptional, IsString, MaxLength, Matches } from 'class-validator';

/**
 * Phase 178 (#12) — record a partial / full bank disbursement. `amount` is a
 * POSITIVE rupee string (≤2 decimals); the service converts to exact paise and
 * flips the settlement to PAID (cumulative reaches net) or PARTIALLY_PAID.
 */
export class RecordSettlementPaymentDto {
  @Matches(/^\d{1,9}(\.\d{1,2})?$/, {
    message: 'amount must be a positive rupee value with up to 2 decimals',
  })
  amount!: string;
}

/**
 * Phase 178 (#4/#11) — freeze (`hold: true`) or release (`hold: false`) a
 * settlement from payout. `holdReason` is bounded + charset-guarded.
 */
export class SettlementHoldDto {
  @IsBoolean({ message: 'hold must be a boolean' })
  hold!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'holdReason must be 300 characters or fewer' })
  @Matches(/^[\w\s.,:;!?@#&()\-/'"₹%+*=\n\r]*$/u, {
    message: 'holdReason contains unsupported characters',
  })
  holdReason?: string;
}
