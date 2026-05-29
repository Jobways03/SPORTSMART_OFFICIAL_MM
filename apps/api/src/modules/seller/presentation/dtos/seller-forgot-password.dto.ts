import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class SellerForgotPasswordDto {
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email!: string;

  // Phase 21 (2026-05-20) — captcha token from the seller-portal
  // forgot-password form. Required when CAPTCHA_PROVIDER is set.
  @IsOptional()
  @IsString()
  captchaToken?: string;
}
