import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PosSaleItemDto {
  @IsNotEmpty({ message: 'Product ID is required' })
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsNotEmpty({ message: 'Quantity is required' })
  @IsNumber({}, { message: 'Quantity must be a number' })
  @Min(1, { message: 'Quantity must be at least 1' })
  quantity: number;

  @IsNotEmpty({ message: 'Unit price is required' })
  @IsNumber({}, { message: 'Unit price must be a number' })
  @Min(0, { message: 'Unit price must be at least 0' })
  unitPrice: number;

  @IsOptional()
  @IsNumber({}, { message: 'Line discount must be a number' })
  @Min(0, { message: 'Line discount must be at least 0' })
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

  @IsOptional()
  @IsIn(['CASH', 'UPI', 'CARD'], {
    message: 'paymentMethod must be one of: CASH, UPI, CARD',
  })
  paymentMethod?: string;

  @IsArray({ message: 'Items must be an array' })
  @ValidateNested({ each: true })
  @Type(() => PosSaleItemDto)
  items: PosSaleItemDto[];
}
