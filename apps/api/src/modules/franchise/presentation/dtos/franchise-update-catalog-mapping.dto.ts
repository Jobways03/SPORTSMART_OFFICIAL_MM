import { IsOptional, IsString, MaxLength, IsBoolean } from 'class-validator';

export class FranchiseUpdateCatalogMappingDto {
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
