import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Admin patch to put a commission on hold (e.g. exchange in progress).
 * Reason is optional but recommended — surfaces to the affiliate via
 * the "On hold — <reason>" pill on their earnings page.
 */
export class AffiliateCommissionHoldDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(500, { message: 'Reason is too long' })
  reason?: string;
}
