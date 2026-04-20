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

export class ReceiptItemDto {
  @IsNotEmpty({ message: 'Item ID is required' })
  @IsUUID(undefined, { message: 'Item ID must be a valid UUID' })
  itemId: string;

  @IsNotEmpty({ message: 'Received quantity is required' })
  @IsNumber({}, { message: 'Received quantity must be a number' })
  @Min(0, { message: 'Received quantity must be at least 0' })
  receivedQty: number;

  @IsOptional()
  @IsNumber({}, { message: 'Damaged quantity must be a number' })
  @Min(0, { message: 'Damaged quantity must be at least 0' })
  damagedQty?: number;
}

export class ProcurementReceiptDto {
  @IsArray({ message: 'Items must be an array' })
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemDto)
  items: ReceiptItemDto[];
}
