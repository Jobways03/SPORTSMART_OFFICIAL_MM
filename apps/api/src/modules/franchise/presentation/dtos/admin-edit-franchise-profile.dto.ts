import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

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

  @IsOptional()
  @IsString()
  @MaxLength(20)
  gstNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
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
