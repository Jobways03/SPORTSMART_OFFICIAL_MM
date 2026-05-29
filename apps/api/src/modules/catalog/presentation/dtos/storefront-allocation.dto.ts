import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Phase 64 (2026-05-22) — class-validator DTOs for the
 * /storefront/allocate/* endpoints (audit Gap #21).
 *
 * Pre-Phase-64 every endpoint accepted inline TS interfaces, so:
 *   - `items` array had no max size — a single POST with 10,000
 *     items burned cluster CPU on the allocator loop
 *   - `customerPincode` was a free string — `abc123` flowed all
 *     the way through to the PostOffice cache miss and produced
 *     bizarre "serviceable at 999km" rankings (audit Gap #19)
 *   - mapping ids / order ids had no UUID validation
 *
 * The bounds here cap the public surface so a hostile anonymous
 * caller (now also gated by Phase 64's auth guard) can't trivially
 * load-amplify behind the rate limiter.
 */

const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;
const MAX_ITEMS_PER_ALLOCATE = 50;
const MAX_QTY_PER_LINE = 99;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class AllocateItemDto {
  @IsUUID(undefined, { message: 'productId must be a UUID' })
  productId!: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'variantId must be a UUID' })
  variantId?: string;

  @IsInt({ message: 'quantity must be an integer' })
  @Min(1, { message: 'quantity must be at least 1' })
  @Max(MAX_QTY_PER_LINE, { message: `quantity must not exceed ${MAX_QTY_PER_LINE}` })
  quantity!: number;
}

export class AllocateRequestDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'items must not be empty' })
  @ArrayMaxSize(MAX_ITEMS_PER_ALLOCATE, {
    message: `Maximum ${MAX_ITEMS_PER_ALLOCATE} items per allocate call`,
  })
  @ValidateNested({ each: true })
  @Type(() => AllocateItemDto)
  items!: AllocateItemDto[];

  @IsString()
  @Transform(trim)
  @Matches(PINCODE_PATTERN, {
    message: 'customerPincode must be a 6-digit Indian pincode',
  })
  customerPincode!: string;
}

export class ReserveRequestDto {
  @IsUUID(undefined, { message: 'mappingId must be a UUID' })
  mappingId!: string;

  @IsInt({ message: 'quantity must be an integer' })
  @Min(1, { message: 'quantity must be at least 1' })
  @Max(MAX_QTY_PER_LINE, { message: `quantity must not exceed ${MAX_QTY_PER_LINE}` })
  quantity!: number;

  @IsOptional()
  @IsUUID(undefined, { message: 'orderId must be a UUID' })
  orderId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120, { message: 'expiresInMinutes must not exceed 120' })
  expiresInMinutes?: number;
}

export class AllocateAndReserveDto {
  @IsUUID(undefined, { message: 'productId must be a UUID' })
  productId!: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'variantId must be a UUID' })
  variantId?: string;

  @IsString()
  @Transform(trim)
  @Matches(PINCODE_PATTERN, {
    message: 'customerPincode must be a 6-digit Indian pincode',
  })
  customerPincode!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_QTY_PER_LINE)
  quantity!: number;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  expiresInMinutes?: number;
}

export class ReleaseRequestDto {
  @IsUUID(undefined, { message: 'reservationId must be a UUID' })
  reservationId!: string;
}

export class ConfirmRequestDto {
  @IsUUID(undefined, { message: 'reservationId must be a UUID' })
  reservationId!: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export class ReallocateRequestDto {
  @IsUUID(undefined, { message: 'orderId must be a UUID' })
  orderId!: string;

  @IsUUID(undefined, { message: 'failedMappingId must be a UUID' })
  failedMappingId!: string;

  @IsUUID(undefined, { message: 'productId must be a UUID' })
  productId!: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsString()
  @Transform(trim)
  @Matches(PINCODE_PATTERN, {
    message: 'customerPincode must be a 6-digit Indian pincode',
  })
  customerPincode!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_QTY_PER_LINE)
  quantity!: number;
}

/**
 * Phase 64 — Storefront public PDP serviceability check (audit
 * Gap #2). Query-string DTO with stricter pincode validation
 * and a max-length safety bound on the ids.
 */
export class CheckServiceabilityQueryDto {
  @IsUUID(undefined, { message: 'productId must be a UUID' })
  productId!: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'variantId must be a UUID' })
  @MaxLength(64)
  variantId?: string;

  @IsString()
  @Transform(trim)
  @Matches(PINCODE_PATTERN, {
    message: 'pincode must be a 6-digit Indian pincode',
  })
  pincode!: string;
}

/**
 * Phase 64 — cart-level serviceability preview DTO (audit Gap #3).
 * The new endpoint is non-mutating: it runs the allocator preview
 * for each cart line at the supplied pincode but never reserves
 * stock.
 */
export class CheckCartServiceabilityDto {
  @IsString()
  @Transform(trim)
  @Matches(PINCODE_PATTERN, {
    message: 'pincode must be a 6-digit Indian pincode',
  })
  pincode!: string;
}
