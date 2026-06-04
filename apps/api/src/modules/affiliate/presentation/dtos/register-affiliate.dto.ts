import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 22 (2026-05-20) — Audit-aligned validation.
 *   • Password gains upper/lower/digit/special + 128-char cap
 *     parity with customer/seller/franchise/admin.
 *   • acceptTerms + acceptPrivacy gates (DPDP §6 — consent must be
 *     specific, informed, unambiguous). Equality enforced server-side
 *     in the use-case.
 *   • websiteUrl → @IsUrl, socialHandle/joinReason → @MaxLength.
 *   • captchaToken from frontend widget; verified server-side.
 */
export class RegisterAffiliateDto {
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  // Indian mobile only — 10 digits, must start with 6/7/8/9 (TRAI
  // mobile range). No country-code prefix; the platform is India-only
  // for now and the dedupe logic relies on a single canonical form.
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')
      : value,
  )
  @Length(10, 10, { message: 'Phone must be exactly 10 digits.' })
  @Matches(/^[6-9]\d{9}$/, {
    message:
      'Phone must be a 10-digit Indian mobile starting with 6, 7, 8, or 9.',
  })
  phone!: string;

  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(1, 100)
  firstName!: string;

  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(1, 100)
  lastName!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  @Matches(/(?=.*[a-z])/, {
    message: 'Password must include a lowercase letter',
  })
  @Matches(/(?=.*[A-Z])/, {
    message: 'Password must include an uppercase letter',
  })
  @Matches(/(?=.*\d)/, { message: 'Password must include a number' })
  @Matches(/(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, {
    message: 'Password must include a special character',
  })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  @IsUrl(
    { require_protocol: true, require_valid_protocol: true },
    { message: 'Website URL must include http:// or https://' },
  )
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  socialHandle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  joinReason?: string;

  // DPDP §6 — Terms of Service consent. Required (the application is
  // refused if missing or false). The use-case writes a marker into
  // the audit log so the consent is provable post-hoc.
  @IsBoolean({ message: 'You must agree to the Terms of Service' })
  acceptTerms!: boolean;

  // DPDP §6 — Privacy Policy consent. Same shape as acceptTerms.
  @IsBoolean({ message: 'You must agree to the Privacy Policy' })
  acceptPrivacy!: boolean;

  // Optional marketing opt-in. Defaults to false. No legal blocker
  // either way.
  @IsOptional()
  @IsBoolean()
  acceptMarketing?: boolean;

  /**
   * Captcha token issued by the frontend widget. Validated server-side
   * via CaptchaVerifierService. When CAPTCHA_PROVIDER=disabled the
   * verifier short-circuits so dev environments don't need to stand
   * up a real challenge.
   */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;
}

export class RejectAffiliateDto {
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class SuspendAffiliateDto {
  @IsString()
  @Length(1, 500)
  reason!: string;
}

// Phase 159h — optional reason on reactivation (why the affiliate was
// reinstated: KYC cleared, fraud probe resolved, etc.).
export class ReactivateAffiliateDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * Phase 159 — per-affiliate commission rate. `percentage` is a number
 * 0–100, or `null` to clear the override (fall back to the platform
 * default). @IsOptional skips validation for null/undefined, so the
 * "clear" case is allowed while a provided value is bounds-checked.
 */
export class UpdateCommissionRateDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  percentage!: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * Phase 159b — create an additional affiliate coupon code. `code` is
 * optional (auto-generated when omitted). The discount/schedule fields
 * mirror the coupon-config editor; the service re-validates cross-field
 * rules (e.g. FREE_SHIPPING carries no value, startsAt < expiresAt).
 */
export class CreateAdditionalCouponDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{4,20}$/, {
    message: 'Coupon code must be 4–20 alphanumeric characters.',
  })
  code?: string;

  @IsOptional()
  @IsIn(['PERCENT', 'FIXED', 'FREE_SHIPPING'])
  customerDiscountType?: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  customerDiscountValue?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxDiscountAmount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrderValue?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxUses?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  perUserLimit?: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

/**
 * Finding #13 — edit an existing affiliate coupon's config (the
 * PATCH :affiliateId/coupons/:couponId editor). Mirrors
 * CreateAdditionalCouponDto's bounds, but every field permits `null`
 * so the editor can CLEAR a value (e.g. drop maxDiscountAmount); the
 * service re-validates the cross-field rules. `revocationReason` is
 * recorded on the row when this update flips isActive → false.
 *
 * Defined as a class (not an inline body type) so class-validator runs
 * under the global whitelist/forbidNonWhitelisted pipe; every existing
 * field is enumerated so previously-accepted requests keep working.
 */
export class UpdateCouponConfigDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn(['PERCENT', 'FIXED', 'FREE_SHIPPING'])
  customerDiscountType?: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING' | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  customerDiscountValue?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxDiscountAmount?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrderValue?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxUses?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  perUserLimit?: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  // Finding #13 — optional human-readable reason recorded on the coupon
  // row when this update DEACTIVATES (revokes) it.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  revocationReason?: string;
}
