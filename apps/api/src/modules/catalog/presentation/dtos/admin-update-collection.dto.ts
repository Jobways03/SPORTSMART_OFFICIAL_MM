import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 37 (2026-05-21) — PATCH semantics; every field optional.
 */
export class AdminUpdateCollectionDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[^<>]+$/, { message: 'name cannot contain < or >' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase letters, digits, and single dashes',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  imageAltText?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
