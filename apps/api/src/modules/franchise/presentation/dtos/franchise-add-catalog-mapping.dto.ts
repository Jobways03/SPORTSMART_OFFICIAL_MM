import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  IsBoolean,
} from 'class-validator';

export class FranchiseAddCatalogMappingDto {
  @IsNotEmpty({ message: 'Product ID is required' })
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  franchiseSku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  barcode?: string;

  @IsOptional()
  @IsBoolean()
  isListedForOnlineFulfillment?: boolean;
}
