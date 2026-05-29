import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PosReturnItemDto {
  @IsNotEmpty({ message: 'Item ID is required' })
  @IsUUID()
  itemId!: string;

  @IsNotEmpty({ message: 'Return quantity is required' })
  @IsInt({ message: 'Return quantity must be a whole number' })
  @Min(1, { message: 'Return quantity must be at least 1' })
  @Max(10_000, { message: 'Return quantity exceeds the per-line maximum' })
  returnQty!: number;

  // Phase 159r (audit #7) — DAMAGED units restock to damagedQty, not sellable
  // onHandQty. Defaults to SALEABLE when the terminal doesn't specify.
  @IsOptional()
  @IsIn(['SALEABLE', 'DAMAGED'], { message: 'condition must be SALEABLE or DAMAGED' })
  condition?: 'SALEABLE' | 'DAMAGED';
}

export class PosReturnSaleDto {
  @IsArray({ message: 'Items must be an array' })
  @ArrayMinSize(1, { message: 'At least one return item is required' })
  @ArrayMaxSize(200, { message: 'A single return cannot exceed 200 line items' })
  @ValidateNested({ each: true })
  @Type(() => PosReturnItemDto)
  items!: PosReturnItemDto[];

  // Phase 159r (audit #12) — how the refund was paid back to the customer.
  @IsNotEmpty({ message: 'refundMethod is required' })
  @IsIn(['CASH', 'UPI', 'CARD', 'MANUAL'], {
    message: 'refundMethod must be one of: CASH, UPI, CARD, MANUAL',
  })
  refundMethod!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Return reason must not exceed 500 characters' })
  returnReason?: string;

  // Acquirer reversal id / UPI refund ref / manual note.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  refundReference?: string;
}
