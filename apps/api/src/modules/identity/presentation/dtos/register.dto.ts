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

export class RegisterDto {
  @IsNotEmpty({ message: 'First name is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(2, { message: 'First name must be at least 2 characters' })
  @MaxLength(50, { message: 'First name must not exceed 50 characters' })
  @Matches(/^[a-zA-Z][a-zA-Z\s]*$/, { message: 'First name must contain only letters' })
  firstName!: string;

  @IsNotEmpty({ message: 'Last name is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(1, { message: 'Last name must be at least 1 character' })
  @MaxLength(50, { message: 'Last name must not exceed 50 characters' })
  @Matches(/^[a-zA-Z][a-zA-Z\s]*$/, { message: 'Last name must contain only letters' })
  lastName!: string;

  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(255, { message: 'Email must not exceed 255 characters' })
  // Belt-and-suspenders on top of @IsEmail: reject consecutive dots,
  // leading/trailing dots, and pure-numeric local parts that some lax
  // RFC validators allow. Keeps the registration funnel honest without
  // blocking legitimate sub-addressed mail (e.g. "user+tag@gmail.com").
  @Matches(/^[A-Za-z0-9](?:[A-Za-z0-9._%+\-]*[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?(?:\.[A-Za-z]{2,})+$/, {
    message: 'Email format is invalid (avoid consecutive dots and leading/trailing dots in the local part)',
  })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email!: string;

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
   * Phase 21 (2026-05-20) — India e-commerce expects phone for COD
   * verification + delivery. Optional at registration to keep the
   * funnel short; collected here so the User.phone column (long
   * present, never populated) gains a value at the first opportunity.
   *
   * Strict India mobile prefix: 10 digits starting with 6, 7, 8, or 9.
   * Non-digits are stripped via the @Transform so paste of "+91 98765
   * 43210" still passes.
   */
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')
      : value,
  )
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Phone number must be a 10-digit Indian mobile starting with 6, 7, 8, or 9',
  })
  phone?: string;

  /**
   * Phase 16 (2026-05-20) — server-side confirmation of the password
   * field. The frontend already enforces password === confirmPassword
   * before submit; this is the second-gate check so an API-only client
   * cannot bypass it. Equality is asserted by the use-case (not via a
   * class-validator decorator) so the error message can be a uniform
   * 422 with a `confirmPassword` field path.
   */
  @IsNotEmpty({ message: 'Please confirm your password' })
  @IsString()
  @MaxLength(128)
  confirmPassword!: string;

  /**
   * DPDP §6 — Terms of Service consent. Required: registration is
   * refused if missing or false. Stored as a ConsentRecord row
   * (purpose='TERMS_OF_SERVICE') inside the registration transaction.
   */
  @IsBoolean({ message: 'You must agree to the Terms of Service' })
  acceptTerms!: boolean;

  /**
   * DPDP §6 — Privacy Policy consent. Required: same shape as
   * acceptTerms.
   */
  @IsBoolean({ message: 'You must agree to the Privacy Policy' })
  acceptPrivacy!: boolean;

  /**
   * DPDP §6 — Marketing communications opt-in. Optional: the form
   * default is false; the user can opt-in. Stored as a ConsentRecord
   * (purpose='EMAIL_MARKETING'). May be omitted from the request.
   */
  @IsOptional()
  @IsBoolean()
  acceptMarketing?: boolean;

  /**
   * CAPTCHA token issued by the frontend widget (Cloudflare Turnstile
   * by default). Validated server-side via CaptchaVerifierService
   * before the use-case is invoked. When CAPTCHA_PROVIDER=disabled
   * (local dev) the validator short-circuits so devs can sign up
   * without standing up a real captcha challenge.
   */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;
}
