import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 37 (2026-05-21) — explicit allowlist DTO. Mirrors the brand
 * + category DTO patterns. `imageUrl` and `imagePublicId` are NOT
 * here — set server-side from the media upload response.
 */
export class AdminCreateCollectionDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'name is required' })
  @MaxLength(80, { message: 'name must not exceed 80 characters' })
  @Matches(/^[^<>]+$/, { message: 'name cannot contain < or >' })
  name!: string;

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

  /**
   * Phase 38 (2026-05-21) — initial products attached in the same
   * multipart create request. The controller calls the existing
   * `addProducts` repo method after the row + image land, so the
   * eligibility filter (ACTIVE + APPROVED + !isDeleted) and `skipped`
   * reporting work the same as the standalone `/products` route.
   *
   * Multipart bodies pass arrays as `initialProductIds[]=…` form
   * fields; the Transform below normalises to a string[] regardless
   * of whether the client sends one value or many. JSON callers can
   * pass a regular array.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) {
      return value
        .filter((v): v is string => typeof v === 'string' && v.length > 0);
    }
    if (typeof value === 'string') {
      return [value];
    }
    return value;
  })
  @IsArray()
  @ArrayMaxSize(500, {
    message: 'cannot attach more than 500 initial products per create',
  })
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    each: true,
    message: 'each initialProductIds entry must be a UUID',
  })
  initialProductIds?: string[];
}
