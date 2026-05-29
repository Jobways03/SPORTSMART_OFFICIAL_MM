import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Phase 159z (GSTR-8 audit #10) — body for the correction-flow
 * endpoint POST /admin/tax/tcs/:ledgerId/reverse.
 *
 * Reverse marks the source row REVERSED and records a free-text
 * reason on the row's computedReason column. The CA / finance is
 * expected to follow up with a fresh computeForSeller pass to
 * produce a corrected row (correctionOfId chain).
 */
export class ReverseTcsDto {
  @IsString()
  @MinLength(6, { message: 'reason must be at least 6 characters' })
  @MaxLength(500, { message: 'reason must be at most 500 characters' })
  reason!: string;
}
