import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Phase 62 (2026-05-22) — class-validator DTOs for the customer
 * coupon-validate endpoint (audit Gap #6).
 *
 * Pre-Phase-62 the controller accepted an inline TS interface, so:
 *   - negative subtotal was passed straight through to the
 *     percent-of-subtotal math
 *   - the code field was unbounded (a 10kB string was a valid
 *     "attempt" that polluted the fraud-attempt table)
 *   - items[].quantity wasn't capped (a 1000-row cart caused
 *     N-squared work in the eligibility evaluator)
 *
 * The bounds here mirror the cart-line DTO from Phase 61: 200
 * items per validate call matches the cart-line cap.
 */

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const MAX_CODE_LENGTH = 64;
const MAX_ITEMS = 200;

export class ValidateCouponItemDto {
  @IsUUID(undefined, { message: 'productId must be a UUID' })
  productId!: string;

  @IsInt({ message: 'quantity must be an integer' })
  @Min(1, { message: 'quantity must be at least 1' })
  @Max(99, { message: 'quantity must not exceed 99' })
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'unitPrice must be a number' })
  @Min(0, { message: 'unitPrice must be non-negative' })
  @Max(1_000_000_000, { message: 'unitPrice exceeds the maximum allowed' })
  unitPrice!: number;
}

export class ValidateCouponDto {
  @IsString()
  // Canonicalize to upper-case at the DTO so downstream lookups
  // hit the same key regardless of how the customer typed it
  // (audit Gap #27 surface — affiliate codes specifically).
  @Transform(upper)
  @MinLength(1, { message: 'Enter a coupon code' })
  @MaxLength(MAX_CODE_LENGTH, {
    message: `Coupon code must not exceed ${MAX_CODE_LENGTH} characters`,
  })
  code!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'subtotal must be a number' })
  @Min(0, { message: 'subtotal must be non-negative' })
  @Max(1_000_000_000, { message: 'subtotal exceeds the maximum allowed' })
  subtotal!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS, {
    message: `Maximum ${MAX_ITEMS} items per coupon validate`,
  })
  @ValidateNested({ each: true })
  @Type(() => ValidateCouponItemDto)
  items?: ValidateCouponItemDto[];

  @IsOptional()
  @IsString()
  @Transform(upper)
  @MaxLength(MAX_CODE_LENGTH)
  currentCouponCode?: string;
}
