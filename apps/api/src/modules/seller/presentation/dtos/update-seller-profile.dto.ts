import { IsOptional, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateSellerProfileDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'Seller name must be at least 2 characters' })
  @MaxLength(100, { message: 'Seller name must not exceed 100 characters' })
  @Matches(/^[a-zA-Z][a-zA-Z\s.\-]*$/, {
    message: 'Name can only contain letters, spaces, dots, and hyphens',
  })
  sellerName?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'Shop name must be at least 2 characters' })
  @MaxLength(150, { message: 'Shop name must not exceed 150 characters' })
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9\s.\-&']*$/, {
    message: 'Shop name contains invalid characters',
  })
  sellerShopName?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^\+\d{1,4}$/, {
    message: 'Country code must be in format like +91 or +1',
  })
  sellerContactCountryCode?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().replace(/\D/g, '') : value,
  )
  @MinLength(7, { message: 'Contact number must be at least 7 digits' })
  @MaxLength(15, { message: 'Contact number must not exceed 15 digits' })
  @Matches(/^\d+$/, { message: 'Contact number must contain only digits' })
  sellerContactNumber?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(5, { message: 'Address must be at least 5 characters' })
  @MaxLength(500, { message: 'Address must not exceed 500 characters' })
  storeAddress?: string;

  @IsOptional()
  @IsString()
  locality?: string;

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
  @MinLength(2, { message: 'State must be at least 2 characters' })
  @MaxLength(100, { message: 'State must not exceed 100 characters' })
  @Matches(/^[a-zA-Z][a-zA-Z\s\-.']*$/, {
    message: 'State can only contain letters, spaces, hyphens, and dots',
  })
  state?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'Country must be at least 2 characters' })
  @MaxLength(100, { message: 'Country must not exceed 100 characters' })
  @Matches(/^[a-zA-Z][a-zA-Z\s]*$/, { message: 'Country name is invalid' })
  country?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(3, { message: 'Zip code must be at least 3 characters' })
  @MaxLength(20, { message: 'Zip code must not exceed 20 characters' })
  @Matches(/^[a-zA-Z0-9\s\-]+$/, {
    message: 'Zip code contains invalid characters',
  })
  sellerZipCode?: string;

  @IsOptional()
  @IsString()
  shortStoreDescription?: string;

  @IsOptional()
  @IsString()
  detailedStoreDescription?: string;

  @IsOptional()
  @IsString()
  sellerPolicy?: string;
}
