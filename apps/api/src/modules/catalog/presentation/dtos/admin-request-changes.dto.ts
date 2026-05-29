import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 31 (2026-05-21) — see AdminRejectProductDto for the rationale.
 */
export class AdminRequestChangesDto {
  @IsString()
  @IsNotEmpty({ message: 'note is required' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(10, { message: 'note must be at least 10 characters' })
  @MaxLength(2000, { message: 'note must not exceed 2000 characters' })
  note!: string;
}
