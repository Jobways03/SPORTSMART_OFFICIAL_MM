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
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

// GST registration type values mirror prisma enum `GstRegistrationType`.
// REGULAR + COMPOSITION + CASUAL all require a valid GSTIN; UNREGISTERED
// does not — small sellers below the threshold can onboard without one.
export enum GstRegistrationTypeDto {
  REGULAR = 'REGULAR',
  COMPOSITION = 'COMPOSITION',
  CASUAL = 'CASUAL',
  UNREGISTERED = 'UNREGISTERED',
}

/**
 * Submitted by the seller themselves once they've filled out their KYC
 * details. Triggers the admin approval queue: verificationStatus moves
 * to UNDER_REVIEW and the admin reviewer sees the seller in the pending
 * list. Bank details are submitted via the separate
 * `update-seller-bank-details` endpoint — this DTO covers legal + GST +
 * PAN + business address only.
 */
export class SubmitSellerOnboardingDto {
  @IsNotEmpty({ message: 'Legal business name is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(2, { message: 'Legal business name must be at least 2 characters' })
  @MaxLength(200, { message: 'Legal business name must not exceed 200 characters' })
  legalBusinessName!: string;

  @IsEnum(GstRegistrationTypeDto, {
    message: 'GST registration type must be REGULAR, COMPOSITION, CASUAL, or UNREGISTERED',
  })
  gstRegistrationType!: GstRegistrationTypeDto;

  // GSTIN required for everything except UNREGISTERED. ValidateIf gates
  // the rule so UNREGISTERED sellers can still submit without one.
  @ValidateIf((o) => o.gstRegistrationType !== GstRegistrationTypeDto.UNREGISTERED)
  @IsNotEmpty({ message: 'GSTIN is required for registered sellers' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @Length(15, 15, { message: 'GSTIN must be exactly 15 characters' })
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, {
    message: 'GSTIN format is invalid (expected: 2-digit state + 10-char PAN + entity + Z + checksum)',
  })
  gstin?: string;

  @ValidateIf((o) => o.gstRegistrationType !== GstRegistrationTypeDto.UNREGISTERED)
  @IsNotEmpty({ message: 'GST state code is required for registered sellers' })
  @IsString()
  @Matches(/^[0-9]{2}$/, { message: 'GST state code must be 2 digits' })
  gstStateCode?: string;

  // PAN is mandatory regardless of GST registration — required for TDS,
  // payouts, and Form 26AS reconciliation.
  @IsNotEmpty({ message: 'PAN number is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @Length(10, 10, { message: 'PAN must be exactly 10 characters' })
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, {
    message: 'PAN format is invalid (expected: 5 letters + 4 digits + 1 letter)',
  })
  panNumber!: string;

  // Registered business address — separate from store address since the
  // GSTIN-registered address can differ from the actual selling location.
  @IsObject({ message: 'Registered business address is required' })
  @IsNotEmpty()
  registeredBusinessAddress!: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
    country?: string;
  };

  // Store / pickup address (where products ship from).
  @IsNotEmpty({ message: 'Store address is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(5)
  @MaxLength(500)
  storeAddress!: string;

  @IsNotEmpty({ message: 'City is required' })
  @IsString()
  @MaxLength(100)
  city!: string;

  @IsNotEmpty({ message: 'State is required' })
  @IsString()
  @MaxLength(100)
  state!: string;

  @IsNotEmpty({ message: 'Country is required' })
  @IsString()
  @MaxLength(100)
  country!: string;

  @IsNotEmpty({ message: 'Zip code is required' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Zip code must be 6 digits (India)' })
  sellerZipCode!: string;

  // Optional locality + contact fields.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  locality?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?\d{1,4}$/, { message: 'Country code must be 1-4 digits with optional +' })
  sellerContactCountryCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10,15}$/, { message: 'Contact number must be 10-15 digits' })
  sellerContactNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  shortStoreDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  detailedStoreDescription?: string;

  // Confirmation flag the seller must tick — explicit consent that the
  // submitted info is accurate. Treated as an audit-trail signal.
  @IsBoolean({ message: 'You must confirm the submitted information is accurate' })
  confirmedAccurate!: boolean;
}
