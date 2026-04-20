import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ProcurementItemDto {
  @IsNotEmpty({ message: 'Product ID is required' })
  @IsUUID(undefined, { message: 'Product ID must be a valid UUID' })
  productId: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Variant ID must be a valid UUID' })
  variantId?: string;

  @IsNotEmpty({ message: 'Quantity is required' })
  @IsNumber({}, { message: 'Quantity must be a number' })
  @Min(1, { message: 'Quantity must be at least 1' })
  quantity: number;
}

export class ProcurementCreateDto {
  @IsArray({ message: 'Items must be an array' })
  @ValidateNested({ each: true })
  @Type(() => ProcurementItemDto)
  items: ProcurementItemDto[];
}
