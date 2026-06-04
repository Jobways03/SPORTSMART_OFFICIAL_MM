import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ApproveItemDto {
  @IsNotEmpty({ message: 'Item ID is required' })
  @IsUUID(undefined, { message: 'Item ID must be a valid UUID' })
  itemId!: string;

  // Phase 236 — upper-bound the quantity at the pipe layer. The service already
  // rejects approvedQty > requestedQty (Phase 159p #3); this is a cheap
  // secondary guard against an absurd value.
  @IsNotEmpty({ message: 'Approved quantity is required' })
  @IsNumber({}, { message: 'Approved quantity must be a number' })
  @Min(0, { message: 'Approved quantity must be at least 0' })
  @Max(1000000, { message: 'Approved quantity is implausibly large' })
  approvedQty!: number;

  // Phase 236/237 — bound the admin-entered landed cost. @Min(0) alone let a
  // fat-finger approve a ₹50k item at ₹0.01 or an absurd ₹10cr/unit; cap it.
  @IsNotEmpty({ message: 'Landed unit cost is required' })
  @IsNumber({}, { message: 'Landed unit cost must be a number' })
  @Min(0, { message: 'Landed unit cost must be at least 0' })
  @Max(10000000, { message: 'Landed unit cost is implausibly large' })
  landedUnitCost!: number;

  @IsOptional()
  @IsString({ message: 'Source seller ID must be a string' })
  sourceSellerId?: string;
}

export class ProcurementApproveDto {
  @IsArray({ message: 'Items must be an array' })
  @ArrayMinSize(1, { message: 'At least one item is required' })
  @ArrayMaxSize(100, { message: 'A request may contain at most 100 items' })
  @ValidateNested({ each: true })
  @Type(() => ApproveItemDto)
  items!: ApproveItemDto[];
}
