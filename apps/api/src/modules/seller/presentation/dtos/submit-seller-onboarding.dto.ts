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
  GST_STATE_CODE_REGEX,
  GSTIN_LENGTH,
  GSTIN_REGEX,
  PAN_LENGTH,
  PAN_REGEX,
  TAX_ID_MESSAGES,
} from '../../../tax/domain/tax-id-rules';

/**
 * GST registration type values mirror prisma enum `GstRegistrationType`.
 *
 * Phase 19 (2026-05-20) — `UNREGISTERED` is removed from the public
 * input contract. The Phase 26 GST policy already mandates GSTIN for
 * every seller; the previous DTO accepted UNREGISTERED only to fail
 * later inside the use case with a confusing 400 ("UNREGISTERED is no
 * longer accepted"). The DTO now rejects the value up-front with a
 * clear validation error.
 */
export enum GstRegistrationTypeDto {
  REGULAR = 'REGULAR',
  COMPOSITION = 'COMPOSITION',
  CASUAL = 'CASUAL',
}

/** Legal entity type — mirrors prisma enum `BusinessEntityType`. */
export enum BusinessEntityTypeDto {
  PUBLIC_LIMITED = 'PUBLIC_LIMITED',
  PRIVATE_LIMITED = 'PRIVATE_LIMITED',
  SOLE_PROPRIETORSHIP = 'SOLE_PROPRIETORSHIP',
  GENERAL_PARTNERSHIP = 'GENERAL_PARTNERSHIP',
  LLP = 'LLP',
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
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 &.,\-/()']*$/, {
    message:
      'Legal business name must start with a letter or digit and contain only letters, digits, spaces, or & . , - / ( ) \'',
  })
  legalBusinessName!: string;

  @IsEnum(GstRegistrationTypeDto, { message: TAX_ID_MESSAGES.GST_REG_TYPE })
  gstRegistrationType!: GstRegistrationTypeDto;

  @IsEnum(BusinessEntityTypeDto, {
    message:
      'Entity type must be a public/private limited company, sole proprietorship, general partnership, or LLP',
  })
  entityType!: BusinessEntityTypeDto;

  /**
   * Phase 19 (2026-05-20) — unconditionally required. Removed the
   * ValidateIf gating on UNREGISTERED; the use case's defensive
   * "GSTIN is required" check is now belt-and-braces against
   * malformed clients, not load-bearing.
   */
  @IsNotEmpty({ message: TAX_ID_MESSAGES.GSTIN_REQUIRED })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @Length(GSTIN_LENGTH, GSTIN_LENGTH, { message: TAX_ID_MESSAGES.GSTIN_LENGTH })
  @Matches(GSTIN_REGEX, { message: TAX_ID_MESSAGES.GSTIN_FORMAT })
  gstin!: string;

  @IsNotEmpty({ message: TAX_ID_MESSAGES.GST_STATE_CODE_REQUIRED })
  @IsString()
  @Matches(GST_STATE_CODE_REGEX, { message: TAX_ID_MESSAGES.GST_STATE_CODE_FORMAT })
  gstStateCode!: string;

  // PAN is mandatory regardless of GST registration — required for TDS,
  // payouts, and Form 26AS reconciliation.
  @IsNotEmpty({ message: TAX_ID_MESSAGES.PAN_REQUIRED })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @Length(PAN_LENGTH, PAN_LENGTH, { message: TAX_ID_MESSAGES.PAN_LENGTH })
  @Matches(PAN_REGEX, { message: TAX_ID_MESSAGES.PAN_FORMAT })
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

  // Rich-text HTML — the real plain-text limit is enforced in the onboarding
  // use-case (short=500, detailed=10000). @MaxLength here guards the RAW HTML
  // payload only and stays well above the plain-text limit so valid formatted
  // content is never rejected at the DTO.
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  shortStoreDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  detailedStoreDescription?: string;

  // Confirmation flag the seller must tick — explicit consent that the
  // submitted info is accurate. Phase 19 (2026-05-20) — the use case
  // now stamps `kycConfirmedAccurateAt` and writes an AuditLog row
  // capturing this consent for the legal record.
  @IsBoolean({ message: 'You must confirm the submitted information is accurate' })
  confirmedAccurate!: boolean;
}
