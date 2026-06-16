import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class AdminLoginDto {
  @IsEmail({}, { message: 'Invalid email address' })
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128, { message: 'Password is too long' })
  password!: string;

  // Phase 23 (2026-05-20) — captcha gate before bcrypt. The admin
  // attack surface is the most valuable in the system; previously the
  // only defense was per-IP throttle (5/60s) which a distributed
  // attack defeats trivially. Verifier short-circuits when
  // CAPTCHA_PROVIDER=disabled so dev still works.
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;

  // The admin portal this login came from. Each admin frontend sends its own
  // value; the login is rejected (after password) when a PORTAL-SPECIFIC role
  // (D2C_ADMIN / RETAILER_ADMIN / FRANCHISE_ADMIN / AFFILIATE_ADMIN) signs in
  // at a different portal. SUPER_ADMIN + generic/ops roles are allowed anywhere.
  // Optional → a client that omits it skips the gate (safe degradation).
  @IsOptional()
  @IsIn(['D2C', 'RETAIL', 'FRANCHISE', 'AFFILIATE', 'SUPER'])
  portalType?: 'D2C' | 'RETAIL' | 'FRANCHISE' | 'AFFILIATE' | 'SUPER';
}

export class AdminForgotPasswordDto {
  @IsEmail({}, { message: 'Invalid email address' })
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;
}

export class AdminVerifyResetOtpDto {
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsString()
  @MinLength(6, { message: 'OTP must be 6 digits' })
  @MaxLength(6)
  otp!: string;
}

export class AdminResendResetOtpDto {
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;
}

export class AdminResetPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  resetToken!: string;

  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(128)
  // Phase 23 (2026-05-20) — same complexity rules the create-admin DTO
  // enforces. The most privileged actor must have the strongest
  // password rules. Mirrors customer/seller/franchise password DTOs.
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
  newPassword!: string;
}
