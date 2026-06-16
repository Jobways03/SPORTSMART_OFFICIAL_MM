import { IsOptional, IsString, MaxLength, IsBoolean } from 'class-validator';

export class FranchiseUpdateCatalogMappingDto {
  // No per-franchise SKU override: the SKU is always the master / global
  // (super-admin) SKU. (franchiseSku removed — not editable.)

  @IsOptional()
  @IsString()
  @MaxLength(50)
  barcode?: string;

  @IsOptional()
  @IsBoolean()
  isListedForOnlineFulfillment?: boolean;
}
