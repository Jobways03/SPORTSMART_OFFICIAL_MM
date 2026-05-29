import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsIn,
  IsInt,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';

export class FranchiseAdjustStockDto {
  @IsNotEmpty({ message: 'Product ID is required' })
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsNotEmpty({ message: 'Adjustment type is required' })
  @IsIn(['DAMAGE', 'LOSS', 'ADJUSTMENT', 'AUDIT_CORRECTION'], {
    message: 'adjustmentType must be one of: DAMAGE, LOSS, ADJUSTMENT, AUDIT_CORRECTION',
  })
  adjustmentType!: 'DAMAGE' | 'LOSS' | 'ADJUSTMENT' | 'AUDIT_CORRECTION';

  // Phase 159o (audit #9) — quantity is a SIGNED integer delta. DAMAGE requires
  // a positive value (units damaged); LOSS / ADJUSTMENT / AUDIT_CORRECTION may
  // be negative to decrement or positive to increment. Previously only
  // @IsNumber, so a fractional 1.5 or an unbounded -50000 passed validation.
  // Bound the magnitude (±1,000,000) and force a whole number; the repository's
  // under-lock `afterQty < 0` guard still prevents any signed delta from
  // driving stock negative.
  @IsNotEmpty({ message: 'Quantity is required' })
  @IsInt({ message: 'Quantity must be a whole number' })
  @Min(-1_000_000, { message: 'Quantity is out of the allowed range' })
  @Max(1_000_000, { message: 'Quantity is out of the allowed range' })
  quantity!: number;

  @IsNotEmpty({ message: 'Reason is required' })
  @IsString()
  @MinLength(3, { message: 'Reason must be at least 3 characters' })
  @MaxLength(500, { message: 'Reason must not exceed 500 characters' })
  reason!: string;
}
