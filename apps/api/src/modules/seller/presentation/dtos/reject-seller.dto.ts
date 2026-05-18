import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Admin rejection of a seller's onboarding submission. The reason is
 * mandatory and surfaced to the seller in their portal so they know
 * what to fix before re-submitting.
 */
export class RejectSellerDto {
  @IsNotEmpty({ message: 'Rejection reason is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(10, { message: 'Rejection reason must be at least 10 characters so the seller can understand the issue' })
  @MaxLength(1000, { message: 'Rejection reason must not exceed 1000 characters' })
  reason!: string;
}
