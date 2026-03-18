import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BulkVariantUpdateItemDto {
  @IsUUID()
  id: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class BulkUpdateVariantsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkVariantUpdateItemDto)
  variants: BulkVariantUpdateItemDto[];
}
