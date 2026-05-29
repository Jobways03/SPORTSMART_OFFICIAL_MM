import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 31 (2026-05-21) — reject reason must be a real, human-readable
 * message. Pre-Phase-31 the DTO accepted "" / whitespace-only strings;
 * the seller's notification email then read "Your product was rejected
 * because " with nothing after. Trim early so a "   " payload also
 * fails @MinLength.
 */
export class AdminRejectProductDto {
  @IsString()
  @IsNotEmpty({ message: 'reason is required' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(10, { message: 'reason must be at least 10 characters' })
  @MaxLength(2000, { message: 'reason must not exceed 2000 characters' })
  reason!: string;
}
