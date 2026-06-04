// Phase 232 (Allocation Preview audit) — DTO for POST /admin/routing/preview.
// Pre-232 the body was an inline `{ pincode, items }` type with hand-rolled
// truthiness checks: a malformed pincode ("abc"/"12") flowed straight into the
// allocator (and onward to the post_offices lookup) instead of a 400, and
// `items` had no per-item shape validation. These validators reject structurally
// bad input at the pipe layer; product EXISTENCE is still checked per-item by
// the allocator (so a single missing product yields a per-item error, not a
// whole-batch 400 — partial results are intentional).

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class RoutingPreviewItemDto {
  @IsString()
  @IsNotEmpty({ message: 'productId is required' })
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string | null;

  @IsInt({ message: 'quantity must be an integer' })
  @Min(1, { message: 'quantity must be >= 1' })
  @Max(1000, { message: 'quantity must be <= 1000' })
  quantity!: number;
}

export class RoutingPreviewDto {
  // Indian PIN: 6 digits, first digit 1-9 (matches the allocator's own guard).
  @Matches(/^[1-9][0-9]{5}$/, {
    message: 'pincode must be a valid 6-digit Indian PIN code',
  })
  pincode!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'items must be a non-empty array' })
  @ArrayMaxSize(50, { message: 'Preview capped at 50 items per request' })
  @ValidateNested({ each: true })
  @Type(() => RoutingPreviewItemDto)
  items!: RoutingPreviewItemDto[];

  // Phase 232 — optional COD modelling so a dry-run can preview which nodes are
  // eligible for a COD vs prepaid order (threaded into the allocator).
  @IsOptional()
  @IsIn(['COD', 'ONLINE'], { message: 'paymentMethod must be COD or ONLINE' })
  paymentMethod?: 'COD' | 'ONLINE';
}
