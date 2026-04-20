import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsIn,
  IsNumber,
  MinLength,
  MaxLength,
} from 'class-validator';

export class FranchiseAdjustStockDto {
  @IsNotEmpty({ message: 'Product ID is required' })
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsNotEmpty({ message: 'Adjustment type is required' })
  @IsIn(['DAMAGE', 'LOSS', 'ADJUSTMENT', 'AUDIT_CORRECTION'], {
    message: 'adjustmentType must be one of: DAMAGE, LOSS, ADJUSTMENT, AUDIT_CORRECTION',
  })
  adjustmentType: 'DAMAGE' | 'LOSS' | 'ADJUSTMENT' | 'AUDIT_CORRECTION';

  @IsNotEmpty({ message: 'Quantity is required' })
  @IsNumber({}, { message: 'Quantity must be a number' })
  quantity: number;

  @IsNotEmpty({ message: 'Reason is required' })
  @IsString()
  @MinLength(3, { message: 'Reason must be at least 3 characters' })
  @MaxLength(500, { message: 'Reason must not exceed 500 characters' })
  reason: string;
}
