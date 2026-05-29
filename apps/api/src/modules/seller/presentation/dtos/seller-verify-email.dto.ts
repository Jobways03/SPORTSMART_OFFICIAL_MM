import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 18 (2026-05-20) — public seller verify-email payload.
 *
 * Distinct from the older `/seller/profile/verify-email/verify`
 * (authed, dashboard-only) — this endpoint accepts `{email, otp}`
 * UNAUTHENTICATED so a brand-new registered seller can verify
 * without first logging in. The audit's "chicken-and-egg" problem
 * (login allowed unverified so OTP could be retrieved) is now
 * solved: registration → verify-email → login.
 */
export class SellerVerifyEmailDto {
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(255)
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email!: string;

  @IsNotEmpty({ message: 'OTP is required' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' })
  otp!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;
}
