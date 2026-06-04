import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 35 (2026-05-21) — explicit allowlist DTO for admin brand
 * update. Mirrors AdminCreateBrandDto but every field is optional
 * because PATCH semantics. `logoPublicId` is deliberately NOT here
 * — it's server-derived from the media upload response.
 */
export class AdminUpdateBrandDto {
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
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }, {
    message: 'logoUrl must be a fully qualified http(s) URL',
  })
  @MaxLength(2048)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  metaDescription?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
