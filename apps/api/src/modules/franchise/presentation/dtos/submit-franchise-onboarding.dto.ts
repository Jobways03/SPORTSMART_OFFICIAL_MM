import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  FRANCHISE_PAN_REGEX,
  IsValidGstinChecksum,
} from './franchise-kyc.validators';

/**
 * Phase 20 (2026-05-20) — Franchise KYC submission.
 *
 * Mirrors the seller-side onboarding DTO. The franchise submits
 * GSTIN + state code + PAN + business address + warehouse address.
 * The use case cross-checks GSTIN positions [0,2) against
 * gstStateCode and positions [2,12) against PAN, and pre-checks
 * GSTIN/PAN uniqueness against other franchises.
 */
export enum FranchiseGstRegistrationTypeDto {
  REGULAR = 'REGULAR',
  COMPOSITION = 'COMPOSITION',
  CASUAL = 'CASUAL',
}

export class SubmitFranchiseOnboardingDto {
  @IsNotEmpty({ message: 'Legal business name is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(2)
  @MaxLength(200)
  legalBusinessName!: string;

  @IsEnum(FranchiseGstRegistrationTypeDto, {
    message: 'GST registration type must be REGULAR, COMPOSITION, or CASUAL',
  })
  gstRegistrationType!: FranchiseGstRegistrationTypeDto;

  @IsNotEmpty({ message: 'GSTIN is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @Length(15, 15, { message: 'GSTIN must be exactly 15 characters' })
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, {
    message: 'GSTIN format is invalid',
  })
  // Phase 159j — Mod-36 checksum (the structural regex above can't catch a
  // transposed digit). Closes audit #13 at the primary KYC entry point.
  @IsValidGstinChecksum()
  gstNumber!: string;

  @IsNotEmpty({ message: 'GST state code is required' })
  @IsString()
  @Matches(/^[0-9]{2}$/, { message: 'GST state code must be 2 digits' })
  gstStateCode!: string;

  @IsNotEmpty({ message: 'PAN number is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @Length(10, 10)
  // Phase 159j — 4th char is the holder-type code (closes audit #12).
  @Matches(FRANCHISE_PAN_REGEX, { message: 'PAN format is invalid' })
  panNumber!: string;

  // Business address — registered address per GSTIN.
  @IsObject({ message: 'Business address is required' })
  @IsNotEmpty()
  businessAddress!: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
    country?: string;
  };

  // Warehouse address — where products ship from. Optional in MVP
  // but recommended pre-activation; admin's payout/logistics setup
  // needs it.
  @IsOptional()
  @IsObject()
  warehouseAddress?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
    country?: string;
  };

  @IsBoolean({ message: 'You must confirm the submitted information is accurate' })
  confirmedAccurate!: boolean;
}
