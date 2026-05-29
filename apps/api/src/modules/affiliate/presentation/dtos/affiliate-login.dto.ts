import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class AffiliateLoginDto {
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128, { message: 'Password is too long' })
  password!: string;

  // Phase 22 (2026-05-20) — captcha token from the affiliate-portal
  // login form. Required when CAPTCHA_PROVIDER is set; the verifier
  // short-circuits when the provider is `disabled` so dev environments
  // don't need a real challenge.
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;
}
