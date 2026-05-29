import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PosSaleItemDto {
  @IsNotEmpty({ message: 'Product ID is required' })
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  // Phase 159q (audit #12) — whole-number quantity with a sane upper bound so a
  // buggy client can't submit quantity: 1_000_000 and only fail at the stock
  // check (or, combined with a unit-price overflow, produce absurd totals).
  @IsNotEmpty({ message: 'Quantity is required' })
  @IsInt({ message: 'Quantity must be a whole number' })
  @Min(1, { message: 'Quantity must be at least 1' })
  @Max(10_000, { message: 'Quantity exceeds the per-line maximum (10000)' })
  quantity!: number;

  @IsNotEmpty({ message: 'Unit price is required' })
  @IsNumber({}, { message: 'Unit price must be a number' })
  @Min(0, { message: 'Unit price must be at least 0' })
  @Max(1_000_000, { message: 'Unit price exceeds the maximum (1,000,000)' })
  unitPrice!: number;

  @IsOptional()
  @IsNumber({}, { message: 'Line discount must be a number' })
  @Min(0, { message: 'Line discount must be at least 0' })
  @Max(1_000_000, { message: 'Line discount exceeds the maximum (1,000,000)' })
  lineDiscount?: number;
}

export class PosRecordSaleDto {
  @IsOptional()
  @IsIn(['WALK_IN', 'PHONE_ORDER', 'LOCAL_DELIVERY'], {
    message: 'saleType must be one of: WALK_IN, PHONE_ORDER, LOCAL_DELIVERY',
  })
  saleType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Customer name must not exceed 100 characters' })
  customerName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10,15}$/, {
    message: 'Customer phone must be 10-15 digits',
  })
  customerPhone?: string;

  // Phase 159q (audit #7) — REQUIRED. Previously optional, and the service
  // silently defaulted a missing value to CASH, so a client bug that dropped
  // the field misclassified the sale as cash. The POS UI always sends it.
  @IsNotEmpty({ message: 'paymentMethod is required' })
  @IsIn(['CASH', 'UPI', 'CARD'], {
    message: 'paymentMethod must be one of: CASH, UPI, CARD',
  })
  paymentMethod!: string;

  @IsArray({ message: 'Items must be an array' })
  @ArrayMinSize(1, { message: 'At least one item is required' })
  @ArrayMaxSize(200, { message: 'A single POS sale cannot exceed 200 line items' })
  @ValidateNested({ each: true })
  @Type(() => PosSaleItemDto)
  items!: PosSaleItemDto[];
}
