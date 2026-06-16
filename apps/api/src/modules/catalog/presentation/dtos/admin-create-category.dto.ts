import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 33 (2026-05-21) — explicit allowlist DTO for admin category
 * create. Pre-Phase-33 the controller accepted `@Body() body: any`,
 * which let an unknown field silently land in the manual destructure
 * (or worse, silently get dropped). The explicit fields below are the
 * only inputs accepted; everything else is rejected by class-validator
 * when `whitelist: true` is on the global ValidationPipe.
 *
 * Deliberately omitted:
 *   - `level` — derived from `parentId.level + 1` server-side. Never
 *     user-input. A future dev adding an `if (body.level)` branch would
 *     create a corruption vector; the DTO removes that surface.
 *   - `createdAt` / `updatedAt` — DB-managed.
 */
export class AdminCreateCategoryDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'name is required' })
  @MaxLength(100, { message: 'name must not exceed 100 characters' })
  // No <> to defeat XSS attempts that inject script tags into the
  // taxonomy. React escapes on render, but defence in depth.
  @Matches(/^[^<>]+$/, { message: 'name cannot contain < or >' })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 &.,\-/()']*$/, {
    message: 'name contains invalid characters',
  })
  name!: string;

  /**
   * Optional custom slug. When omitted the controller derives it from
   * the name via `toSlug()`. URL-safe charset, max 80.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'slug must not exceed 80 characters' })
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase letters, digits, and single dashes (no leading/trailing dash)',
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
  @MaxLength(60, { message: 'metaTitle must not exceed 60 characters (SEO cap)' })
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160, { message: 'metaDescription must not exceed 160 characters (SEO cap)' })
  metaDescription?: string;

  @IsOptional()
  @IsUUID('4', { message: 'parentId must be a UUID' })
  parentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
