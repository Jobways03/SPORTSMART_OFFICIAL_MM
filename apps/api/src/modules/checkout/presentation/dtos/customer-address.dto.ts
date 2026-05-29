import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 63 (2026-05-22) — customer-address DTOs replacing the
 * pre-Phase-63 inline `@Body() body: {...}` shape (audit Gap #4).
 *
 * Pre-Phase-63 the controller accepted an inline TS interface, so:
 *   - mass-assignment exposure: client could submit `customerId`,
 *     `createdAt`, `id` in the body
 *   - no max-length enforcement at the framework layer
 *   - the storefront sent `+91XXXXXXXXXX` phones but the service
 *     regex `/^[6-9][0-9]{9}$/` only stripped whitespace+dashes,
 *     so every save with the storefront-normalised phone 400'd
 *     (audit Gap #8)
 *
 * The phone @Transform here is the canonical fix for Gap #8 — it
 * strips a leading `+91` / `91` / non-digit characters BEFORE the
 * @Matches regex runs, so both `+919876543210` (storefront-shape)
 * and `9876543210` (raw) succeed equally.
 */

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizePhone = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const digitsOnly = value.replace(/[^\d]/g, '');
  // Strip the country code if the client sent +91-prefixed.
  // Accept both `+91 98765 43210` and `9876543210` shapes.
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return digitsOnly.slice(2);
  }
  return digitsOnly;
};

const PIN_PATTERN = /^[1-9][0-9]{5}$/;
const MOBILE_PATTERN = /^[6-9][0-9]{9}$/;
const STATE_CODE_PATTERN = /^[0-9]{2}$/;

export enum AddressTypeDto {
  HOME = 'HOME',
  WORK = 'WORK',
  OTHER = 'OTHER',
}

export class CreateAddressDto {
  @IsString()
  @Transform(trim)
  @MinLength(2, { message: 'fullName must be at least 2 characters' })
  @MaxLength(100, { message: 'fullName must not exceed 100 characters' })
  fullName!: string;

  @IsString()
  @Transform(normalizePhone)
  @Matches(MOBILE_PATTERN, {
    message:
      'phone must be a 10-digit Indian mobile number starting with 6, 7, 8, or 9 (with or without +91 prefix)',
  })
  phone!: string;

  @IsString()
  @Transform(trim)
  @MinLength(4, { message: 'addressLine1 must be at least 4 characters' })
  @MaxLength(200, { message: 'addressLine1 must not exceed 200 characters' })
  addressLine1!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(200, { message: 'addressLine2 must not exceed 200 characters' })
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(100, { message: 'locality must not exceed 100 characters' })
  locality?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(100, { message: 'landmark must not exceed 100 characters' })
  landmark?: string;

  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(100, { message: 'city must not exceed 100 characters' })
  city!: string;

  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(100, { message: 'state must not exceed 100 characters' })
  state!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(STATE_CODE_PATTERN, {
    message: 'stateCode must be the 2-digit CBIC GST state code',
  })
  stateCode?: string;

  @IsString()
  @Transform(trim)
  @Matches(PIN_PATTERN, {
    message:
      'postalCode must be a 6-digit Indian PIN (first digit non-zero)',
  })
  postalCode!: string;

  @IsOptional()
  @IsEnum(AddressTypeDto, {
    message: 'addressType must be HOME, WORK, or OTHER',
  })
  addressType?: AddressTypeDto;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(2)
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsString()
  @Transform(normalizePhone)
  @Matches(MOBILE_PATTERN, {
    message:
      'phone must be a 10-digit Indian mobile number starting with 6, 7, 8, or 9 (with or without +91 prefix)',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(4)
  @MaxLength(200)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(200)
  addressLine2?: string | null;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(100)
  locality?: string | null;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(100)
  landmark?: string | null;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(STATE_CODE_PATTERN)
  stateCode?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(PIN_PATTERN)
  postalCode?: string;

  @IsOptional()
  @IsEnum(AddressTypeDto)
  addressType?: AddressTypeDto;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
