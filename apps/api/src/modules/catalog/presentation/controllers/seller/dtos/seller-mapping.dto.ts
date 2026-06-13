import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Phase 51 (2026-05-21) — class-validator DTOs for the seller
 * product-mapping controller. Pre-Phase-51 the controller declared
 * inline TypeScript interfaces, which NestJS's ValidationPipe could
 * not validate — every field was effectively `any` for the
 * type-checker AND for runtime validation. The audit flagged this
 * as the largest mass-assignment surface in the seller flow.
 *
 * Each new validator is aligned with the Phase 47/49/50 patterns:
 *   - @IsUUID on entity refs (productId, variantId, mappingId)
 *   - @Matches(/^\d{6}$/) on Indian pincode
 *   - @IsLatitude / @IsLongitude on coordinates
 *   - @MaxLength caps on free-text columns
 *   - @IsInt @Min(0) on counters
 *   - @IsNumber @Min(0) on prices
 *   - Bulk update array bounded to 100 entries (DoS guard)
 */

const PINCODE_PATTERN = /^\d{6}$/;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class MapProductDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000, { message: 'stockQty must not exceed 1,000,000' })
  stockQty!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  settlementPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  procurementCost?: number;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(64)
  sellerInternalSku?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  pickupAddress?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(PINCODE_PATTERN, { message: 'pickupPincode must be a 6-digit Indian pincode' })
  pickupPincode?: string;

  @IsOptional()
  @IsLatitude({ message: 'latitude must be a valid latitude (-90 to 90)' })
  latitude?: number;

  @IsOptional()
  @IsLongitude({ message: 'longitude must be a valid longitude (-180 to 180)' })
  longitude?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30, { message: 'dispatchSla must not exceed 30 days' })
  dispatchSla?: number;
}

export class UpdateMappingDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000, { message: 'stockQty must not exceed 1,000,000' })
  stockQty?: number;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(64)
  sellerInternalSku?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  settlementPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  procurementCost?: number;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  pickupAddress?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(PINCODE_PATTERN, { message: 'pickupPincode must be a 6-digit Indian pincode' })
  pickupPincode?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  dispatchSla?: number;

  // Phase 58 (2026-05-22) — isActive removed (audit Gaps #3 + #9).
  // Pre-Phase-58 a seller could PATCH isActive=false to hide a
  // mapping (without flipping approvalStatus), then PATCH
  // isActive=true to bring it back — bypassing the admin-stop /
  // /reapprove lifecycle. The new POST /mapping/:id/pause endpoint
  // is the only way for a seller to take a live mapping off the
  // storefront, and re-activation requires admin /reapprove.

  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;
}

/**
 * Phase 58 (2026-05-22) — seller-initiated pause of an APPROVED
 * mapping (audit Gaps #3 + #9). Symmetric with admin /stop:
 * approvalStatus → STOPPED, isActive → false, stoppedBy = sellerId.
 * Re-activation requires admin /reapprove — sellers cannot silently
 * lift their own pause, which closes the "self-pause + self-resume
 * without admin review" loop the audit flagged.
 */
export class SellerPauseMappingDto {
  @IsString()
  @Transform(trim)
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500, { message: 'reason must not exceed 500 characters' })
  reason!: string;
}

/**
 * Phase 51 — single row inside the bulk endpoint. Adds optional
 * lowStockThreshold so sellers can bulk-set thresholds alongside
 * stock without a second round trip (audit Gap #4).
 */
export class BulkStockUpdateRowDto {
  @IsUUID()
  mappingId!: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000, { message: 'stockQty must not exceed 1,000,000' })
  stockQty!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;
}

export class BulkStockUpdateDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'updates array must not be empty' })
  @ArrayMaxSize(100, { message: 'Maximum 100 updates per request' })
  @ValidateNested({ each: true })
  @Type(() => BulkStockUpdateRowDto)
  updates!: BulkStockUpdateRowDto[];
}
