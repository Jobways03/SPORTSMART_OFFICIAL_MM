import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class SellerLoginDto {
  @IsNotEmpty({ message: 'Email or phone number is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  identifier!: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  @MaxLength(128, { message: 'Password is too long' })
  password!: string;

  // Phase 21 (2026-05-20) — captcha token from the seller-portal
  // login form. Required when CAPTCHA_PROVIDER is set; ignored when
  // the verifier service is in passthrough mode.
  @IsOptional()
  @IsString()
  captchaToken?: string;
}
