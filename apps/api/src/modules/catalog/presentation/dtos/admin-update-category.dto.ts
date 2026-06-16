import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 33 (2026-05-21) — explicit allowlist DTO for admin category
 * update. Mirrors AdminCreateCategoryDto but every field is optional
 * because PATCH semantics. Validation runs on present fields only.
 *
 * `parentId` is special: it can be set to `null` to promote a
 * category to root, OR a UUID to re-parent it. ValidateIf gates the
 * UUID check so the explicit `null` path passes.
 *
 * `level` is NOT here — derived from parentId server-side.
 */
export class AdminUpdateCategoryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'name cannot be empty' })
  @MaxLength(100)
  @Matches(/^[^<>]+$/, { message: 'name cannot contain < or >' })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 &.,\-/()']*$/, {
    message: 'name contains invalid characters',
  })
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
  @IsUrl({ require_protocol: true }, { message: 'imageUrl must be a fully qualified URL' })
  @MaxLength(2048)
  imageUrl?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'bannerUrl must be a fully qualified URL' })
  @MaxLength(2048)
  bannerUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  metaDescription?: string;

  /**
   * UUID or explicit `null` (promote to root). Anything else fails.
   * The class-validator @Matches below accepts UUID format; null is
   * gated by @ValidateIf so undefined falls through.
   */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'parentId must be a UUID or null',
  })
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
