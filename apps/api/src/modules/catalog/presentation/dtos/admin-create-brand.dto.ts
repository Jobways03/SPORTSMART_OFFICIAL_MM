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
 * create. See AdminCreateCategoryDto for the mass-assignment
 * rationale. logoUrl is `@IsUrl` with protocol-restricted to
 * http/https so `javascript:` / `data:` payloads can't sneak past
 * the storefront's React JSX escaping into a future DOM-mutating
 * renderer.
 */
export class AdminCreateBrandDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'name is required' })
  @MaxLength(80, { message: 'name must not exceed 80 characters' })
  @Matches(/^[^<>]+$/, { message: 'name cannot contain < or >' })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 &.,\-/()']*$/, {
    message: 'name contains invalid characters',
  })
  name!: string;

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
  @MaxLength(60, { message: 'metaTitle must not exceed 60 characters (SEO cap)' })
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160, { message: 'metaDescription must not exceed 160 characters (SEO cap)' })
  metaDescription?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
