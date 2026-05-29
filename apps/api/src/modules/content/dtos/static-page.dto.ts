import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PageStatus } from '@prisma/client';

/**
 * Phase 49 (2026-05-21) — split DTOs for static-page CRUD.
 *
 * Pre-Phase-49 the single `UpsertStaticPageDto` accepted slug from
 * the URL only (no DTO field) and was wired to PUT, so a typo in
 * the URL silently created a new draft page (audit Gap #7). The new
 * DTOs enforce:
 *
 *   - slug regex pattern + max length (Gap #10)
 *   - separate create vs. update shapes (Gap #7)
 *   - SEO fields (canonicalUrl, ogImage, noIndex) (Gap #13)
 *   - status enum alongside legacy `published` boolean (Gap #12)
 *
 * Body sanitization (Gap #3) is service-side — the DTO accepts raw
 * HTML, the service strips dangerous tags / attributes / schemes
 * before persisting.
 */

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Slug regex: lowercase letters + digits + hyphens, must start with a
// letter or digit, no consecutive hyphens. Matches what Next.js, SEO
// best practice, and most CMSs accept.
export const STATIC_PAGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const STATIC_PAGE_SLUG_MESSAGE =
  'slug must be lowercase letters/numbers with hyphen separators (e.g. "refund-policy")';

// Phase 49 — same safe-href allowlist as Phase 47 / Phase 48 admin
// surfaces. Used for canonicalUrl / ogImage.
const SAFE_URL_PATTERN = /^(?:\/(?!\/)[^\s]*|https?:\/\/[^\s]+)$/;
const SAFE_URL_MESSAGE =
  '$property must be a relative path starting with "/" or an http(s) URL';

export class CreateStaticPageDto {
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(80)
  @Matches(STATIC_PAGE_SLUG_PATTERN, { message: STATIC_PAGE_SLUG_MESSAGE })
  slug!: string;

  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @IsString()
  @MaxLength(100_000)
  body!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(200)
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(300)
  metaDesc?: string;

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

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsEnum(PageStatus)
  status?: PageStatus;
}

export class UpdateStaticPageDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  body?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(200)
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(300)
  metaDesc?: string;

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

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsEnum(PageStatus)
  status?: PageStatus;
}
