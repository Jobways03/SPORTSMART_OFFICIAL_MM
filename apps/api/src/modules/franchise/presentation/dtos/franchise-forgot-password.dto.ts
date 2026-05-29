import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class FranchiseForgotPasswordDto {
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email!: string;

  // Phase 26 (2026-05-20) — captcha parity with customer / seller /
  // affiliate / admin forgot-password endpoints. Required when
  // CAPTCHA_PROVIDER is enabled; the verifier short-circuits otherwise.
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;
}
