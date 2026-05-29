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
 * Phase 20 (2026-05-20) — Franchise register payload.
 *
 * Added (consent + bot-protection):
 *   • confirmPassword — server-side mirror of the form match.
 *   • acceptTerms + acceptPrivacy — DPDP §6 required consent.
 *   • acceptMarketing — optional opt-in.
 *   • captchaToken — verified before bcrypt.
 *
 * Tightened:
 *   • Phone strict India mobile ^[6-9]\d{9}$ replacing loose ^\d{10,15}$.
 */
export class FranchiseRegisterDto {
  @IsNotEmpty({ message: 'Owner name is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(2, { message: 'Owner name must be at least 2 characters' })
  @MaxLength(100, { message: 'Owner name must not exceed 100 characters' })
  @Matches(/^[a-zA-Z][a-zA-Z\s.\-]*$/, { message: 'Owner name must contain only letters, spaces, dots, or hyphens' })
  ownerName!: string;

  @IsNotEmpty({ message: 'Business name is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(2, { message: 'Business name must be at least 2 characters' })
  @MaxLength(150, { message: 'Business name must not exceed 150 characters' })
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9\s.\-&']*$/, { message: 'Business name contains invalid characters' })
  businessName!: string;

  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(255, { message: 'Email must not exceed 255 characters' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email!: string;

  @IsNotEmpty({ message: 'Phone number is required' })
  @IsString()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const digits = value.trim().replace(/\D/g, '');
    return digits.startsWith('91') && digits.length === 12
      ? digits.slice(2)
      : digits;
  })
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

  @IsNotEmpty({ message: 'Please confirm your password' })
  @IsString()
  @MaxLength(128)
  confirmPassword!: string;

  @IsBoolean({ message: 'You must agree to the Terms of Service' })
  acceptTerms!: boolean;

  @IsBoolean({ message: 'You must agree to the Privacy Policy' })
  acceptPrivacy!: boolean;

  @IsOptional()
  @IsBoolean()
  acceptMarketing?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;
}
