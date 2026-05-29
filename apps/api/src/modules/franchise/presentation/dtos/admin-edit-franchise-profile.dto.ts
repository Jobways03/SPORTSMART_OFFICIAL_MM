import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  FRANCHISE_PAN_REGEX,
  FRANCHISE_GSTIN_REGEX,
  IsValidGstinChecksum,
} from './franchise-kyc.validators';

export class AdminEditFranchiseProfileDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MaxLength(100)
  ownerName?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MaxLength(150)
  businessName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10,15}$/, { message: 'Phone number must be 10-15 digits' })
  phoneNumber?: string;

  // Phase 159j — the admin-edit path previously had NO PAN/GST format check
  // (@MaxLength(20) only), so an admin could persist a malformed identifier
  // that a reviewer then VERIFIED. Now mirrors the franchise self-edit DTO:
  // structural regex + Mod-36 checksum (GST) and 4th-char holder type (PAN).
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(FRANCHISE_GSTIN_REGEX, { message: 'Please enter a valid GST number' })
  @IsValidGstinChecksum()
  gstNumber?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(FRANCHISE_PAN_REGEX, { message: 'Please enter a valid PAN number' })
  panNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Pincode must be exactly 6 digits' })
  pincode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  locality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  warehouseAddress?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Warehouse pincode must be exactly 6 digits' })
  warehousePincode?: string;
}
