import {
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Self-service profile patch. Every field is optional so the frontend
 * can send only what changed. Email is intentionally NOT editable
 * here — changing it requires a verification flow we haven't built.
 * Status / KYC / commission rate are admin-controlled and live on
 * separate endpoints.
 *
 * Empty strings on the optional clearable fields (websiteUrl,
 * socialHandle, joinReason) are normalised to null so callers can
 * "clear" a value by sending `""`.
 */
export class AffiliateUpdateProfileDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 64, { message: 'First name must be between 1 and 64 characters' })
  firstName?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 64, { message: 'Last name must be between 1 and 64 characters' })
  lastName?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Phone must be a 10-digit Indian mobile starting with 6, 7, 8, or 9.',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  // Allow `""` to mean "clear the field" — normalised in the service.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(2048, { message: 'Website URL is too long' })
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(64, { message: 'Social handle is too long' })
  socialHandle?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(2000, { message: 'Reason is too long' })
  joinReason?: string;
}
