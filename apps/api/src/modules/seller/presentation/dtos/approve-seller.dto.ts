import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Admin approval of a seller's onboarding submission.
 * Notes are optional and recorded on the seller's verification trail —
 * useful for "GST verified by manual lookup on portal X" kind of context.
 */
export class ApproveSellerDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MaxLength(1000, { message: 'Notes must not exceed 1000 characters' })
  notes?: string;
}
