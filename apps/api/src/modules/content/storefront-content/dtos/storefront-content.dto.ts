import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 47 — single source of truth for the "safe href" allowlist. We
 * accept:
 *   - relative paths starting with `/`         (most existing seed data)
 *   - absolute http(s) URLs                    (Cloudinary, external)
 * We reject (caught by failing the regex):
 *   - `javascript:`, `data:`, `vbscript:`      (XSS via <a href>)
 *   - `//evil.com/path` protocol-relative URLs (open redirect)
 *   - bare strings without `/` or scheme       (no rendering meaning)
 *
 * Phase 48 (2026-05-21) — tightened to reject `//…` via a negative
 * lookahead after the leading slash. The prior pattern silently
 * accepted protocol-relative URLs.
 */
const SAFE_HREF_PATTERN = /^(?:\/(?!\/)[^\s]*|https?:\/\/[^\s]+)$/;
const SAFE_HREF_MESSAGE =
  '$property must be a relative path starting with "/" or an http(s) URL';

/**
 * Phase 47 (2026-05-21) — class-validated DTOs for the storefront
 * slot + content write paths. Replaces the prior TS interfaces which
 * NestJS could not auto-validate. The URL validators reject
 * `javascript:` / `data:` / scheme-less hrefs that pre-Phase-47 the
 * inline body silently accepted (storefront then rendered them in
 * `<a href>` — open-redirect / XSS adjacent).
 */

export const ALLOWED_SECTION_KEYS = [
  'hero',
  'sport-tiles-strip',
  'equipping-champions',
  'most-loved-deals',
  'banner-promo',
  'unite-play',
  'partner-promos',
  'brand-chips',
] as const;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateSlotDto {
  @IsString()
  @IsIn(ALLOWED_SECTION_KEYS as readonly string[])
  sectionKey!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(64)
  slotKey?: string;

  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @IsOptional()
  @Matches(SAFE_HREF_PATTERN, { message: SAFE_HREF_MESSAGE })
  @MaxLength(500)
  defaultHref?: string | null;
}

export class UpsertStorefrontContentDto {
  // imageUrl is set by the upload endpoint; explicit upsert payloads
  // typically don't include it. When present, must be a Cloudinary
  // or relative URL.
  @IsOptional()
  @Matches(SAFE_HREF_PATTERN, { message: SAFE_HREF_MESSAGE })
  @MaxLength(800)
  imageUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160, { message: 'imageAlt must not exceed 160 characters (search-snippet length)' })
  imageAlt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  eyebrow?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  headline?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subhead?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  ctaLabel?: string | null;

  /**
   * Phase 47 — strict scheme allowlist. Pre-Phase-47 the column was a
   * free string and admin could set `ctaHref='javascript:alert(1)'`.
   * The storefront's `<a href>` would render it, and a future
   * renderer that dropped the React default escape would execute it.
   * The allowlist also blocks `data:` and protocol-less `//evil.com`
   * open-redirects.
   */
  @IsOptional()
  @Matches(SAFE_HREF_PATTERN, { message: SAFE_HREF_MESSAGE })
  @MaxLength(800)
  ctaHref?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  price?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  priceCaption?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsDateString()
  startAt?: string | null;

  @IsOptional()
  @IsDateString()
  endAt?: string | null;
}
