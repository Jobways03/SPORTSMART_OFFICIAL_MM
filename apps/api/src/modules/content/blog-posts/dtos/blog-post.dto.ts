import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { BlogPostStatus } from '@prisma/client';

/**
 * Phase 50 (2026-05-21) — class-validator-backed DTOs for blog
 * posts. Pre-Phase-50 the controller accepted TS interfaces which
 * Nest's ValidationPipe could not validate; admins could post
 * 50MB contentHtml or 100 duplicate-cased tags.
 *
 * Body sanitization (Gap #2) is service-side — the DTO accepts raw
 * HTML up to a length cap; the service strips dangerous tags /
 * attributes / schemes via sanitizeCmsBody before persisting.
 */

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Slug regex: lowercase letters + digits + hyphens, must start with a
// letter or digit. Mirrors the static-page slug pattern.
export const BLOG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Same safe-href allowlist as Phase 47-49. Accepts /relative and
// http(s):// only; rejects javascript: / data: / protocol-relative.
const SAFE_URL_PATTERN = /^(?:\/(?!\/)[^\s]*|https?:\/\/[^\s]+)$/;
const SAFE_URL_MESSAGE =
  '$property must be a relative path starting with "/" or an http(s) URL';

export class CreateBlogPostDto {
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(80)
  @Matches(BLOG_SLUG_PATTERN, {
    message:
      'slug must be lowercase letters/numbers with hyphen separators (e.g. "new-shoes-launch")',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  excerpt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  contentHtml?: string;

  @IsOptional()
  @Matches(SAFE_URL_PATTERN, { message: SAFE_URL_MESSAGE })
  @MaxLength(800)
  imageUrl?: string | null;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(160, {
    message: 'imageAlt must not exceed 160 characters (search-snippet length)',
  })
  imageAlt?: string | null;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(80)
  author?: string | null;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: 'tags must not exceed 20 entries' })
  @ArrayUnique({ message: 'tags must not contain duplicates' })
  @IsString({ each: true })
  @MaxLength(40, { each: true, message: 'each tag must not exceed 40 characters' })
  tags?: string[];

  @IsOptional()
  @IsEnum(BlogPostStatus)
  status?: BlogPostStatus;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(200)
  metaTitle?: string | null;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(300)
  metaDesc?: string | null;

  @IsOptional()
  @Matches(SAFE_URL_PATTERN, { message: SAFE_URL_MESSAGE })
  @MaxLength(500)
  canonicalUrl?: string | null;

  @IsOptional()
  @Matches(SAFE_URL_PATTERN, { message: SAFE_URL_MESSAGE })
  @MaxLength(800)
  ogImage?: string | null;

  @IsOptional()
  @IsBoolean()
  noIndex?: boolean;
}

export class UpdateBlogPostDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(80)
  @Matches(BLOG_SLUG_PATTERN, {
    message:
      'slug must be lowercase letters/numbers with hyphen separators',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  excerpt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  contentHtml?: string;

  @IsOptional()
  @Matches(SAFE_URL_PATTERN, { message: SAFE_URL_MESSAGE })
  @MaxLength(800)
  imageUrl?: string | null;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(160)
  imageAlt?: string | null;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(80)
  author?: string | null;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsEnum(BlogPostStatus)
  status?: BlogPostStatus;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(200)
  metaTitle?: string | null;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(300)
  metaDesc?: string | null;

  @IsOptional()
  @Matches(SAFE_URL_PATTERN, { message: SAFE_URL_MESSAGE })
  @MaxLength(500)
  canonicalUrl?: string | null;

  @IsOptional()
  @Matches(SAFE_URL_PATTERN, { message: SAFE_URL_MESSAGE })
  @MaxLength(800)
  ogImage?: string | null;

  @IsOptional()
  @IsBoolean()
  noIndex?: boolean;
}
