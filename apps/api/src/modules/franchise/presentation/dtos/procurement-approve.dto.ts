import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ApproveItemDto {
  @IsNotEmpty({ message: 'Item ID is required' })
  @IsUUID(undefined, { message: 'Item ID must be a valid UUID' })
  itemId: string;

  @IsNotEmpty({ message: 'Approved quantity is required' })
  @IsNumber({}, { message: 'Approved quantity must be a number' })
  @Min(0, { message: 'Approved quantity must be at least 0' })
  approvedQty: number;

  @IsNotEmpty({ message: 'Landed unit cost is required' })
  @IsNumber({}, { message: 'Landed unit cost must be a number' })
  @Min(0, { message: 'Landed unit cost must be at least 0' })
  landedUnitCost: number;

  @IsOptional()
  @IsString({ message: 'Source seller ID must be a string' })
  sourceSellerId?: string;
}

export class ProcurementApproveDto {
  @IsArray({ message: 'Items must be an array' })
  @ValidateNested({ each: true })
  @Type(() => ApproveItemDto)
  items: ApproveItemDto[];
}
