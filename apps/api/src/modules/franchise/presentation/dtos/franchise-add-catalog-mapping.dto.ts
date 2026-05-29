import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FranchiseAddCatalogMappingDto {
  @IsNotEmpty({ message: 'Product ID is required' })
  @IsUUID()
  productId!: string;

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

/**
 * Phase 159n (audit #11) — bulk add, capped so a franchise can't submit an
 * unbounded array (each row triggers product/variant lookups).
 */
export class BulkAddCatalogMappingsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FranchiseAddCatalogMappingDto)
  mappings!: FranchiseAddCatalogMappingDto[];
}
