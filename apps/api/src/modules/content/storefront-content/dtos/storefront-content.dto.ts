import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Phase 47 — single source of truth for the "safe href" allowlist. We
 * accept:
 *   - relative paths starting with `/`         (most existing seed data)
 *   - absolute http(s) URLs                    (media, external)
 * We reject (caught by failing the regex):
 *   - `javascript:`, `data:`, `vbscript:`      (XSS via <a href>)
 *   - `//evil.com/path` protocol-relative URLs (open redirect)
 *   - bare strings without `/` or scheme       (no rendering meaning)
 *
 * Phase 48 (2026-05-21) — tightened to reject `//…` via a negative
 * lookahead after the leading slash. The prior pattern silently
 * accepted protocol-relative URLs.
 */
export const SAFE_HREF_PATTERN = /^(?:\/(?!\/)[^\s]*|https?:\/\/[^\s]+)$/;
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

/**
 * Phase 48 — device-targeting allowlist. Kept in sync with the Prisma
 * `StorefrontDeviceVisibility` enum (ALL / DESKTOP_ONLY / MOBILE_ONLY).
 * Validated as a string union here so the DTO has no Prisma-runtime
 * dependency; the service persists it directly to the enum column.
 */
export const ALLOWED_DEVICE_VISIBILITY = [
  'ALL',
  'DESKTOP_ONLY',
  'MOBILE_ONLY',
] as const;

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

  // Phase 48 — explicit position is optional; the service appends to
  // the end of the section when omitted. Bounded so a fat-finger can't
  // push a slot to position 2^31.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  position?: number;
}

/**
 * Phase 48 (Finding #15) — partial update for an existing slot
 * definition. Identity columns (sectionKey / slotKey) are immutable, so
 * only the presentational fields can change. Every field is optional;
 * an empty body is a no-op.
 */
export class UpdateSlotDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @Matches(SAFE_HREF_PATTERN, { message: SAFE_HREF_MESSAGE })
  @MaxLength(500)
  defaultHref?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  position?: number;
}

/**
 * Phase 48 (Finding #16) — one item of a bulk reorder request. Each
 * entry pins a slot id to its new position; the service applies them in
 * a single transaction.
 */
export class ReorderSlotItemDto {
  @IsUUID()
  id!: string;

  @IsInt()
  @Min(0)
  @Max(100000)
  position!: number;
}

export class ReorderSlotsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReorderSlotItemDto)
  items!: ReorderSlotItemDto[];
}

export class UpsertStorefrontContentDto {
  // imageUrl is set by the upload endpoint; explicit upsert payloads
  // typically don't include it. When present, must be a media
  // or relative URL.
  @IsOptional()
  @Matches(SAFE_HREF_PATTERN, { message: SAFE_HREF_MESSAGE })
  @MaxLength(800)
  imageUrl?: string | null;

  // Phase 48 (Finding #3) — optional mobile-specific artwork. Same
  // scheme allowlist as imageUrl so a `data:`/`javascript:` payload is
  // rejected at the boundary. When null the storefront falls back to
  // imageUrl.
  @IsOptional()
  @Matches(SAFE_HREF_PATTERN, { message: SAFE_HREF_MESSAGE })
  @MaxLength(800)
  imageUrlMobile?: string | null;

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

  // Phase 48 (Finding #3) — which device classes should render this
  // block. Defaults to ALL on the column; validated as the string
  // union so the DTO stays free of a Prisma-runtime import.
  @IsOptional()
  @IsIn(ALLOWED_DEVICE_VISIBILITY as readonly string[])
  deviceVisibility?: string;

  @IsOptional()
  @IsDateString()
  startAt?: string | null;

  @IsOptional()
  @IsDateString()
  endAt?: string | null;

  // Phase 48 (Finding #21) — optimistic-concurrency token. When the
  // admin UI sends the version it last read, the service rejects the
  // write with 409 if another admin has since bumped the row. Optional
  // so legacy callers (and the upload path) are unaffected.
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
