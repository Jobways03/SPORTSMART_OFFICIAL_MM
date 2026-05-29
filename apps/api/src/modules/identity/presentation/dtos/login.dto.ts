import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(255, { message: 'Email must not exceed 255 characters' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email!: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  // Phase 17 (2026-05-20) — short-circuit huge password payloads
  // BEFORE the use-case runs bcrypt. bcrypt-cost-12 on a 1 MB string
  // takes minutes of CPU; an attacker that drips 100 such requests
  // wedges the API. The login bcrypt cap at the framework boundary
  // mirrors the register DTO's 128-char limit.
  @MinLength(1, { message: 'Password is required' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  password!: string;

  /**
   * Phase 17 (2026-05-20) — Cloudflare Turnstile / hCaptcha token.
   * Verified server-side by CaptchaVerifierService before bcrypt
   * runs, so a missing / invalid captcha never pays the bcrypt cost.
   * When CAPTCHA_PROVIDER=disabled (local dev) the verifier
   * short-circuits and the token may be empty.
   */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;
}
