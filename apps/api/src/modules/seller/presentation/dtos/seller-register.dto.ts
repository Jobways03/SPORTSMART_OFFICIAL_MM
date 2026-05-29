import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 18 (2026-05-20) — seller register payload.
 *
 * Removed from this DTO:
 *   • `sellerType` — the audit flagged it as a spoof vector (a D2C
 *     portal could submit `sellerType: 'RETAIL'`). The new model
 *     derives sellerType server-side from the `X-Seller-Type`
 *     header that each portal's api-client already bakes in
 *     (see apps/web-d2c-seller/src/lib/api-client.ts and
 *     apps/web-retail-seller/src/lib/api-client.ts). The
 *     controller reads the header and asserts it against the
 *     CORS origin to defeat client-side override.
 *
 * Added to this DTO:
 *   • `confirmPassword` — server-side mirror of the form check.
 *   • `acceptTerms` + `acceptPrivacy` — DPDP §6 consent gates.
 *   • `captchaToken` — CAPTCHA verifier consumes before bcrypt.
 *
 * Tightened:
 *   • Phone is now strict India mobile format (10-digit starting
 *     with 6/7/8/9). The previous 10-15 digit loose form let
 *     duplicates slip in via different country-code prefixes.
 */
export class SellerRegisterDto {
  @IsNotEmpty({ message: 'Seller name is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(2, { message: 'Seller name must be at least 2 characters' })
  @MaxLength(100, { message: 'Seller name must not exceed 100 characters' })
  @Matches(/^[a-zA-Z][a-zA-Z\s.\-]*$/, { message: 'Seller name must contain only letters, spaces, dots, or hyphens' })
  sellerName!: string;

  @IsNotEmpty({ message: 'Shop name is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(2, { message: 'Shop name must be at least 2 characters' })
  @MaxLength(150, { message: 'Shop name must not exceed 150 characters' })
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9\s.\-&']*$/, { message: 'Shop name contains invalid characters' })
  sellerShopName!: string;

  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(255, { message: 'Email must not exceed 255 characters' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email!: string;

  @IsNotEmpty({ message: 'Phone number is required' })
  @IsString()
  // Strip everything that isn't a digit (handles +91 prefixes, spaces,
  // dashes, etc.) and the leading 91 country code if present.
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const digits = value.trim().replace(/\D/g, '');
    return digits.startsWith('91') && digits.length === 12
      ? digits.slice(2)
      : digits;
  })
  // Phase 18 (2026-05-20) — strict India mobile format. First digit
  // 6-9 (India mobile prefix), exactly 10 digits. Defeats the
  // "different country code, same number" duplicate-account vector.
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Phone number must be a 10-digit Indian mobile number starting with 6, 7, 8, or 9',
  })
  phoneNumber!: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  @Matches(/(?=.*[a-z])/, { message: 'Password must include a lowercase letter' })
  @Matches(/(?=.*[A-Z])/, { message: 'Password must include an uppercase letter' })
  @Matches(/(?=.*\d)/, { message: 'Password must include a number' })
  @Matches(/(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, { message: 'Password must include a special character' })
  password!: string;

  /**
   * Phase 18 (2026-05-20) — server-side confirmation. The frontend
   * enforces match before submit; this is the second-gate so an
   * API-only client can't bypass it.
   */
  @IsNotEmpty({ message: 'Please confirm your password' })
  @IsString()
  @MaxLength(128)
  confirmPassword!: string;

  /** DPDP §6 — Terms of Service consent. Required. */
  @IsBoolean({ message: 'You must agree to the Terms of Service' })
  acceptTerms!: boolean;

  /** DPDP §6 — Privacy Policy consent. Required. */
  @IsBoolean({ message: 'You must agree to the Privacy Policy' })
  acceptPrivacy!: boolean;

  /** DPDP §6 — Optional marketing comms opt-in. Defaults to false. */
  @IsOptional()
  @IsBoolean()
  acceptMarketing?: boolean;

  /**
   * Cloudflare Turnstile / hCaptcha token. Verified before bcrypt
   * runs. When `CAPTCHA_PROVIDER=disabled` (local dev) the verifier
   * short-circuits and this can be empty.
   */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;
}
