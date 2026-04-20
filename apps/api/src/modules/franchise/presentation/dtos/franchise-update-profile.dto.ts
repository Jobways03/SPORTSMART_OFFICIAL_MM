import { IsOptional, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class FranchiseUpdateProfileDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'Owner name must be at least 2 characters' })
  @MaxLength(100, { message: 'Owner name must not exceed 100 characters' })
  @Matches(/^[a-zA-Z][a-zA-Z\s.\-]*$/, {
    message: 'Owner name can only contain letters, spaces, dots, and hyphens',
  })
  ownerName?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'Business name must be at least 2 characters' })
  @MaxLength(150, { message: 'Business name must not exceed 150 characters' })
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9\s.\-&']*$/, {
    message: 'Business name contains invalid characters',
  })
  businessName?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'State must be at least 2 characters' })
  @MaxLength(100, { message: 'State must not exceed 100 characters' })
  @Matches(/^[a-zA-Z][a-zA-Z\s\-.']*$/, {
    message: 'State can only contain letters, spaces, hyphens, and dots',
  })
  state?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'City must be at least 2 characters' })
  @MaxLength(100, { message: 'City must not exceed 100 characters' })
  @Matches(/^[a-zA-Z][a-zA-Z\s\-.']*$/, {
    message: 'City can only contain letters, spaces, hyphens, and dots',
  })
  city?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(5, { message: 'Address must be at least 5 characters' })
  @MaxLength(500, { message: 'Address must not exceed 500 characters' })
  address?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^\d{6}$/, { message: 'Pincode must be exactly 6 digits' })
  pincode?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(150, { message: 'Locality must not exceed 150 characters' })
  locality?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'Country must be at least 2 characters' })
  @MaxLength(100, { message: 'Country must not exceed 100 characters' })
  @Matches(/^[a-zA-Z][a-zA-Z\s\-.']*$/, {
    message: 'Country can only contain letters, spaces, hyphens, and dots',
  })
  country?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/, {
    message: 'Please enter a valid GST number',
  })
  gstNumber?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{5}\d{4}[A-Z]{1}$/, {
    message: 'Please enter a valid PAN number',
  })
  panNumber?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(5, { message: 'Warehouse address must be at least 5 characters' })
  @MaxLength(500, { message: 'Warehouse address must not exceed 500 characters' })
  warehouseAddress?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^\d{6}$/, { message: 'Warehouse pincode must be exactly 6 digits' })
  warehousePincode?: string;
}
