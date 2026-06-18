import { IsIn, IsOptional, IsString, Length } from 'class-validator';

/**
 * Admin actions that DRIVE the liability ledger (vs the read-only browse).
 *   - Logistics claim transition: advance a courier claim through its
 *     PENDING → SUBMITTED → ACCEPTED → RECOVERED lifecycle, or REJECTED.
 *   - Platform expense reverse: un-book a mis-attributed absorbed cost.
 */

export const LOGISTICS_CLAIM_TRANSITIONS = [
  'SUBMITTED',
  'ACCEPTED',
  'RECOVERED',
  'REJECTED',
  'CANCELLED',
] as const;
export type LogisticsClaimTransition =
  (typeof LOGISTICS_CLAIM_TRANSITIONS)[number];

export class TransitionLogisticsClaimDto {
  @IsIn(LOGISTICS_CLAIM_TRANSITIONS as unknown as string[])
  toStatus!: LogisticsClaimTransition;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class ReversePlatformExpenseDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}
