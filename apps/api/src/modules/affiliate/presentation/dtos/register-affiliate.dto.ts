import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

export class RegisterAffiliateDto {
  @IsEmail()
  email!: string;

  // Indian mobile only — 10 digits, must start with 6/7/8/9 (TRAI
  // mobile range). No country-code prefix; the platform is India-only
  // for now and the dedupe logic relies on a single canonical form.
  @IsString()
  @Length(10, 10, { message: 'Phone must be exactly 10 digits.' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Phone must be a 10-digit Indian mobile starting with 6, 7, 8, or 9.',
  })
  phone!: string;

  @IsString()
  @Length(1, 100)
  firstName!: string;

  @IsString()
  @Length(1, 100)
  lastName!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  socialHandle?: string;

  @IsOptional()
  @IsString()
  joinReason?: string;
}

export class RejectAffiliateDto {
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class SuspendAffiliateDto {
  @IsString()
  @Length(1, 500)
  reason!: string;
}
