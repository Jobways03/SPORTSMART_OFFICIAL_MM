import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class SellerLoginDto {
  @IsNotEmpty({ message: 'Email or phone number is required' })
  @IsString()
  @MaxLength(255)
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
  @MaxLength(4096)
  captchaToken?: string;

  // The seller portal this login came from. The D2C portal sends 'D2C', the
  // Retail portal sends 'RETAIL'. The login is rejected (after password check)
  // if the seller's own type doesn't match — so each portal only accepts its
  // own seller type. Optional for safe degradation: a client that omits it
  // skips the gate (login still works).
  @IsOptional()
  @IsIn(['D2C', 'RETAIL'])
  portalType?: 'D2C' | 'RETAIL';
}
