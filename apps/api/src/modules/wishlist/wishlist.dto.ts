import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Phase 202 (#4 / #19) — class-validator DTOs replacing the
 * pre-Phase-202 inline TS interfaces.
 *
 * Pre-Phase-202 the wishlist controller declared its POST body as a
 * bare TS `interface AddToWishlistDto`. NestJS's global ValidationPipe
 * (whitelist + forbidNonWhitelisted + transform) cannot validate an
 * interface — at runtime every field was effectively `any`. A hostile
 * client could POST `{ productId: 12345, note: "<script>...", junk: 1 }`
 * and the request reached the service before the hand-rolled typeof
 * checks ran; the `junk` field also sailed through (no
 * forbidNonWhitelisted enforcement for an untyped body).
 *
 * Per-field rules:
 *   - @IsUUID on productId / variantId so a malformed id is rejected at
 *     the pipe layer (not a service-level findUnique miss).
 *   - note: @MaxLength(280) mirrors the @db.VarChar(280) column, and a
 *     @Transform strips angle brackets + ASCII/Unicode control chars
 *     (#19). The note is rendered verbatim in the wishlist UI; stripping
 *     `<`/`>` here is defence-in-depth against an XSS payload being
 *     stored and later reflected by a careless consumer.
 */

const MAX_NOTE_LENGTH = 280;

// Phase 202 (#19) — strip angle brackets (stored-XSS entry point) and
// control characters from the customer-supplied note. The regex is built
// programmatically from char codes so the SOURCE file carries no literal
// control bytes. Range: C0 (0x00-0x1F) minus TAB(0x09)/LF(0x0A)/CR(0x0D),
// plus DEL(0x7F) and the C1 controls (0x80-0x9F).
const NOTE_STRIP_RE = (() => {
  const allowed = new Set([0x09, 0x0a, 0x0d]);
  const codes: string[] = ['<', '>'];
  for (let c = 0x00; c <= 0x9f; c++) {
    if (c >= 0x20 && c <= 0x7e) continue; // printable ASCII stays
    if (allowed.has(c)) continue;
    codes.push('\\u' + c.toString(16).padStart(4, '0'));
  }
  // eslint-disable-next-line security/detect-non-literal-regexp
  return new RegExp('[' + codes.join('') + ']', 'g');
})();

/**
 * Strip angle brackets and control characters from a customer-supplied
 * note, then trim. Returns the value untouched when it isn't a string
 * so class-validator's @IsString can still reject non-strings.
 */
function sanitizeNote({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(NOTE_STRIP_RE, '').trim();
}

export class AddToWishlistDto {
  @IsUUID(undefined, { message: 'productId must be a UUID' })
  productId!: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'variantId must be a UUID' })
  variantId?: string;

  @IsOptional()
  @Transform(sanitizeNote)
  @IsString({ message: 'note must be a string' })
  @MaxLength(MAX_NOTE_LENGTH, {
    message: `note must be ${MAX_NOTE_LENGTH} characters or fewer`,
  })
  note?: string;
}

/**
 * Phase 202 (#5 / #18) — typed pagination query for GET /customer/wishlist.
 * Pre-Phase-202 the controller hand-parsed `page` / `limit` strings with
 * `parseInt(...) || default`, which silently swallowed garbage and had no
 * upper bound enforced at the pipe layer. The transforms coerce the raw
 * query strings to integers; @Min/@Max bound them.
 */
export class WishlistListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit must not exceed 100' })
  limit?: number;
}
