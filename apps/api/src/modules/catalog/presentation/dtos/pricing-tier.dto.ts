import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 44 (2026-05-21) — class-validated DTOs for the pricing-tier
 * write paths. Replaces the prior `PricingTierWriteInput` TS
 * interface (which NestJS could not auto-validate). The DTO also
 * encodes the mutual-exclusion invariant between discountPercent
 * and fixedUnitPrice: exactly one must be set on every write.
 */

export class CreatePricingTierDto {
  @IsOptional()
  @IsUUID('4')
  variantId?: string;

  @IsInt()
  @Min(1)
  @Max(100_000)
  minQuantity!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  maxQuantity?: number;

  /**
   * Mutually exclusive with `fixedUnitPrice`. Either-or; never both.
   * The controller layer enforces XOR after class-validator passes.
   */
  @ValidateIf((o: CreatePricingTierDto) => o.fixedUnitPrice === undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ValidateIf((o: CreatePricingTierDto) => o.discountPercent === undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fixedUnitPrice?: number;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(120)
  displayLabel?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;
}

export class UpdatePricingTierDto {
  @IsOptional()
  @IsUUID('4')
  variantId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  minQuantity?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  maxQuantity?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPercent?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fixedUnitPrice?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayLabel?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  startAt?: string | null;

  @IsOptional()
  @IsDateString()
  endAt?: string | null;
}
